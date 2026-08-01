# Runtime self-healing v1

## Problem

The HTML shell could load while the JavaScript runtime stayed dead. The previous recovery was one-shot: after the browser stored the current build marker, a later mixed PWA cache could leave the page stuck on `Подключение…` with `--:--:--` and empty market panels.

## Fix

- introduce a separate recovery revision so affected browsers perform one new scoped cleanup;
- watch the header clock for successful runtime startup;
- if the clock is still dead after 8 seconds, unregister only the InPuls Service Worker scope and delete only `inpuls-*` CacheStorage entries;
- preserve localStorage settings, IndexedDB and Signal Lab history;
- cap automatic recovery to one attempt per session;
- expose a manual retry through the connection status instead of looping forever.

## Acceptance

- a stale or mixed PWA runtime automatically reloads once;
- a healthy runtime is not reloaded;
- unrelated Service Workers and caches are untouched;
- no settings or collected history are deleted;
- repeated startup failure becomes visible and manually retryable.
