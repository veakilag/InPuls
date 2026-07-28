export const INPULS_CACHE_PREFIX = "inpuls-";

function asUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isInPulsRegistration(registration, pageUrl = globalThis.location?.href) {
  const baseUrl = asUrl(pageUrl);
  const scopeUrl = asUrl(registration?.scope);
  const scriptUrl = asUrl(
    registration?.active?.scriptURL
      || registration?.waiting?.scriptURL
      || registration?.installing?.scriptURL,
  );
  if (!baseUrl || !scopeUrl || !scriptUrl) return false;
  const expectedScope = new URL("./", baseUrl);
  const expectedScript = new URL("./sw.js", baseUrl);
  return (
    scopeUrl.origin === expectedScope.origin
    && scopeUrl.pathname === expectedScope.pathname
    && scriptUrl.origin === expectedScript.origin
    && scriptUrl.pathname === expectedScript.pathname
  );
}

export async function clearInPulsRuntime({
  cacheStorage = globalThis.caches,
  navigatorObject = globalThis.navigator,
  pageUrl = globalThis.location?.href,
} = {}) {
  let registrationsRemoved = 0;
  let cachesRemoved = 0;
  if (navigatorObject && "serviceWorker" in navigatorObject) {
    const registrations = await navigatorObject.serviceWorker.getRegistrations();
    const owned = registrations.filter((registration) => isInPulsRegistration(registration, pageUrl));
    const results = await Promise.all(owned.map((registration) => registration.unregister()));
    registrationsRemoved = results.filter(Boolean).length;
  }
  if (cacheStorage) {
    const keys = await cacheStorage.keys();
    const owned = keys.filter((key) => key.startsWith(INPULS_CACHE_PREFIX));
    const results = await Promise.all(owned.map((key) => cacheStorage.delete(key)));
    cachesRemoved = results.filter(Boolean).length;
  }
  return { registrationsRemoved, cachesRemoved };
}
