# Ad Astra — test setup

Zero-dependency unit tests using Node's built-in test runner (`node --test`,
Node 20+). No bundler, no jsdom, no build step — just the four source files
these tests actually exercise, run directly as the ES modules they already are.

## Install & run

There's nothing to `npm install` — `node:test` and `node:assert` ship with
Node itself. Drop `package.json` and `tests/` into the project root
(alongside `storage.js`, `ai.js`, etc.) and run:

```
npm test
```

which is just `node --test tests/*.test.js`. (`node --test tests/` without
the glob works inconsistently across Node versions for discovering nested
helper files, so the script pins the glob explicitly.)

## What's covered, and why these four

- **`reviewFlashcard` (storage.js)** — the SM-2-lite spaced-repetition math.
  Pure arithmetic with real user-facing consequences (get it wrong and
  cards get scheduled incorrectly for weeks), and it was previously
  untested.
- **`rebuildLinksFor` (storage.js)** — `[[wikilink]]` parsing. Regex-driven,
  has to get de-duplication, self-link exclusion, case-insensitive title
  matching, and "don't touch manual links" all correct at once.
- **`migrateNotesToHierarchy` (storage.js)** — the one-time legacy-note
  upgrade. Runs on every load (`initNotes()` calls it unconditionally) and
  needs to be a correct no-op on already-migrated data, or every user's
  vault silently reshuffles on the next visit.
- **`extractFacts` (ai.js)** — feeds quizzes, flashcards, and the Materials
  digest. If this drifts, generated quizzes silently get worse without any
  errors being thrown.

## How the storage.js tests work

`storage.js` keeps its state in module-level variables, not something it
exposes for tests to reach into. Rather than reading private state, the
tests use the same two exported functions the app itself uses to
initialize and reset that state:

- `initStorage()` — called once per test file (via `resetStorage()` in
  `tests/helpers/fixtures.js`). `config.js` points at a real Supabase
  project, so this tries `import('https://esm.sh/...')`; Node's ESM loader
  rejects non-`file:`/`data:` URL schemes immediately, with no network
  round trip, so this deterministically (and fast) falls back to local
  mode on any machine, online or offline. That fallback logs a
  `console.warn`, which the helper swallows since it's expected noise.
- `importData(...)` — called before **every** test to fully replace
  `notes`/`note_links`/etc. with that test's fixture, so tests never see
  leftover state from storage.js's built-in demo seed data or from a
  previous test.

`tests/helpers/local-storage-polyfill.js` gives `storage.js` a real (if
tiny) in-memory `localStorage`, since it calls `localStorage.getItem/
setItem` directly with no availability check — it's written for a browser.
Its own `try/catch`s would silently swallow the `ReferenceError` under
plain Node anyway, but relying on a caught error as the test setup
mechanism is fragile and non-obvious, so this makes it a real (working)
call instead.

`crypto.randomUUID()` needs no polyfill — it's a global in Node 19+.

## Quirks the tests intentionally pin down

Two small asymmetries in `extractFacts` came up while writing these tests.
Neither looks like it was deliberate, and neither breaks anything today,
but they're worth knowing about:

1. Blockquote (`> `) lines keep `**bold**` markers, while bullet lines and
   plain lines both have them stripped.
2. The heading-skip regex (`/^#{1,3}\s+/`) only matches 1–3 leading `#`s.
   A `#### heading` line isn't recognized as a heading at all — it falls
   through to the plain-line length check and gets extracted as a "fact"
   (hashes and all) if it's 12–220 characters long.

Both are captured as `quirk:` tests in `tests/ai.extractFacts.test.js` so
that fixing either one is a deliberate choice, not an accidental
regression somewhere down the line.

## Sanity-checking the tests themselves

Every test file was verified against a deliberately-broken copy of its
source function (wrong SM-2 ease floor, case-sensitive subject matching,
missing self-link exclusion, wrong fact-length bound) to confirm it
actually fails when the logic is wrong, not just when the fixture is
malformed.
