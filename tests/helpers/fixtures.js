// fixtures.js — shared setup for storage.js unit tests.
//
// storage.js keeps its state (`cache`) in module-level variables, not
// something it exposes for tests to poke at directly. `initStorage()` is
// the only thing that ever creates that state in the first place, and
// `importData()` is a real exported function that fully replaces
// notes/note_links/etc. — so we use those two, exactly as app.js would,
// instead of reaching into module internals.
import './local-storage-polyfill.js';
import { initStorage, importData } from '../../storage.js';

let started = false;

// Resets the in-memory vault to exactly the collections you pass in
// (defaulting everything else to empty), so each test starts from known,
// isolated state — no bleed-through from storage.js's built-in demo seed
// data or from whatever a previous test left behind.
export async function resetStorage(payload = {}) {
  if (!started) {
    // Config.js points at a real Supabase URL, so initStorage() will try
    // to `import('https://esm.sh/...')`. Node's default ESM loader
    // rejects non-file/data URL schemes immediately (no network round
    // trip involved), so this deterministically — and quickly — falls
    // back to local mode on every machine, online or not. It does log a
    // console.warn about it, which we swallow here since it's expected
    // noise, not a real problem.
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await initStorage();
    } finally {
      console.warn = originalWarn;
    }
    started = true;
  }
  await importData({
    notes: [],
    note_links: [],
    graph_objects: [],
    materials: [],
    tests: [],
    flashcards: [],
    ...payload,
  });
}

let noteCounter = 0;
export function note(overrides = {}) {
  noteCounter += 1;
  return {
    id: `note-${noteCounter}`,
    user_id: 'local',
    type: 'note',
    parent_id: null,
    title: `Note ${noteCounter}`,
    color: '#6F00FF',
    tags: [],
    subject: 'General',
    body: '',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

let cardCounter = 0;
export function flashcard(overrides = {}) {
  cardCounter += 1;
  return {
    id: `card-${cardCounter}`,
    user_id: 'local',
    front: 'front',
    back: 'back',
    subject: 'General',
    next_review: '2026-01-01T00:00:00.000Z',
    interval_days: 0,
    ease: 2.5,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
