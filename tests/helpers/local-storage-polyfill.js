// local-storage-polyfill.js
//
// storage.js talks to `localStorage` directly (it's written for the
// browser), with no availability check. Under plain Node there's no such
// global. Its own try/catch blocks would silently swallow the resulting
// ReferenceError and fall back to an empty in-memory cache anyway — so
// this polyfill isn't strictly load-bearing for the tests to pass — but
// relying on a swallowed ReferenceError as our test setup mechanism is
// fragile and unclear. This gives storage.js a real (if tiny) localStorage
// to read and write so its actual code paths run, not just its fallback
// paths.
//
// Import this before importing storage.js (directly, or transitively via
// ai.js / notes.js) in any test file that needs it.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
  };
}
