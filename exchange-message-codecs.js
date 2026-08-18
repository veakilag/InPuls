const textDecoder = new TextDecoder();

async function messageBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof Blob === "function" && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return new TextEncoder().encode(String(data ?? ""));
}

export async function decodeJsonMessage(data) {
  if (typeof data === "string") return JSON.parse(data);
  return JSON.parse(textDecoder.decode(await messageBytes(data)));
}

export async function decodeGzipJsonMessage(data) {
  if (typeof data === "string") return data === "Ping" ? data : JSON.parse(data);
  const bytes = await messageBytes(data);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    const text = textDecoder.decode(bytes);
    return text === "Ping" ? text : JSON.parse(text);
  }
  if (typeof DecompressionStream !== "function") throw new Error("Gzip WebSocket data is unsupported by this browser");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return text === "Ping" ? text : JSON.parse(text);
}

function readVarint(bytes, state) {
  let result = 0n;
  let shift = 0n;
  while (state.offset < bytes.length) {
    const byte = bytes[state.offset++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return result;
    shift += 7n;
    if (shift > 70n) throw new Error("Invalid protobuf varint");
  }
  throw new Error("Truncated protobuf varint");
}

function numberFromVarint(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : String(value);
}

function readProtoFields(bytes) {
  const fields = [];
  const state = { offset: 0 };
  while (state.offset < bytes.length) {
    const tag = Number(readVarint(bytes, state));
    const field = tag >>> 3;
    const wire = tag & 7;
    if (!field) throw new Error("Invalid protobuf field");
    if (wire === 0) {
      fields.push({ field, wire, value: numberFromVarint(readVarint(bytes, state)) });
      continue;
    }
    if (wire === 1) {
      state.offset += 8;
      continue;
    }
    if (wire === 2) {
      const length = Number(readVarint(bytes, state));
      const end = state.offset + length;
      if (end > bytes.length) throw new Error("Truncated protobuf field");
      fields.push({ field, wire, value: bytes.subarray(state.offset, end) });
      state.offset = end;
      continue;
    }
    if (wire === 5) {
      state.offset += 4;
      continue;
    }
    throw new Error(`Unsupported protobuf wire type ${wire}`);
  }
  return fields;
}

function protoText(value) {
  return textDecoder.decode(value);
}

function first(fields, field, fallback = null) {
  return fields.find((item) => item.field === field)?.value ?? fallback;
}

function decodeMexcDepthItem(bytes) {
  const fields = readProtoFields(bytes);
  return [protoText(first(fields, 1, new Uint8Array())), protoText(first(fields, 2, new Uint8Array()))];
}

function decodeMexcDepth(bytes, aggregate) {
  const fields = readProtoFields(bytes);
  const asks = fields.filter((item) => item.field === 1).map((item) => decodeMexcDepthItem(item.value));
  const bids = fields.filter((item) => item.field === 2).map((item) => decodeMexcDepthItem(item.value));
  return {
    asks,
    bids,
    eventType: first(fields, 3),
    sequence: first(fields, aggregate ? 5 : 4),
    firstSequence: aggregate ? first(fields, 4) : null,
    eventTime: first(fields, aggregate ? 6 : 5),
  };
}

function decodeMexcDeals(bytes) {
  const fields = readProtoFields(bytes);
  return fields.filter((item) => item.field === 1).map((item) => {
    const row = readProtoFields(item.value);
    return {
      price: protoText(first(row, 1, new Uint8Array())),
      quantity: protoText(first(row, 2, new Uint8Array())),
      tradeType: first(row, 3),
      time: first(row, 4),
      id: protoText(first(row, 5, new Uint8Array())),
    };
  });
}

function decodeMexcKline(bytes) {
  const fields = readProtoFields(bytes);
  const readString = (field) => protoText(first(fields, field, new Uint8Array()));
  return {
    interval: readString(1),
    time: Number(first(fields, 2)) * 1_000,
    open: readString(3),
    close: readString(4),
    high: readString(5),
    low: readString(6),
    volume: readString(7),
    amount: readString(8),
    closeTime: Number(first(fields, 9)) * 1_000,
  };
}

export async function decodeMexcProtobufMessage(data) {
  const fields = readProtoFields(await messageBytes(data));
  const payload = {
    channel: protoText(first(fields, 1, new Uint8Array())),
    symbol: protoText(first(fields, 3, new Uint8Array())),
    createTime: first(fields, 5),
    sendTime: first(fields, 6),
  };
  const limitDepth = first(fields, 303);
  const kline = first(fields, 308);
  const aggregateDepth = first(fields, 313);
  const deals = first(fields, 314);
  if (limitDepth) payload.depth = decodeMexcDepth(limitDepth, false);
  if (aggregateDepth) payload.depth = decodeMexcDepth(aggregateDepth, true);
  if (deals) payload.deals = decodeMexcDeals(deals);
  if (kline) payload.kline = decodeMexcKline(kline);
  return payload;
}
