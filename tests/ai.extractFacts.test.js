// ai.extractFacts.test.js
//
// Covers extractFacts(body): pulls bullets, blockquotes, and standalone
// lines of plausible "fact" length out of a note body, so quizzes and
// flashcards are grounded in the user's own wording.
//
// A couple of tests below ("quirk: ...") pin down two asymmetries in the
// current implementation rather than an intended spec — worth knowing
// about even if nobody decides to change them:
//   - blockquote (`>`) lines keep `**bold**` markers, while bullets and
//     plain lines have them stripped.
//   - the heading-skip regex only matches 1-3 leading `#`s, so a `####`
//     line isn't treated as a heading — it falls through to the
//     plain-line length check instead.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/local-storage-polyfill.js';
import { extractFacts } from '../ai.js';

describe('extractFacts', () => {
  test('returns an empty array for empty or missing input', () => {
    assert.deepEqual(extractFacts(''), []);
    assert.deepEqual(extractFacts(null), []);
    assert.deepEqual(extractFacts(undefined), []);
  });

  test('skips heading lines (#, ##, ###)', () => {
    const body = '# Title\n## Subtitle\n### Sub-subtitle\nThis is a plain sentence long enough.';
    assert.deepEqual(extractFacts(body), ['This is a plain sentence long enough.']);
  });

  test('extracts bullet lines (- or *) and strips bold markers', () => {
    const body = '- **Conduction** — direct contact\n* Second bullet point here';
    assert.deepEqual(extractFacts(body), [
      'Conduction — direct contact',
      'Second bullet point here',
    ]);
  });

  test('extracts blockquote lines', () => {
    const body = '> The derivative is a limit of a difference quotient';
    assert.deepEqual(extractFacts(body), ['The derivative is a limit of a difference quotient']);
  });

  test('keeps standalone lines only within the 12-220 character window', () => {
    const tooShort = 'short';          // 5 chars
    const justRight = 'x'.repeat(12);  // exactly 12
    const atMax = 'x'.repeat(220);     // exactly 220
    const tooLong = 'x'.repeat(221);   // 221 chars
    const body = [tooShort, justRight, tooLong, atMax].join('\n');

    assert.deepEqual(extractFacts(body), [justRight, atMax]);
  });

  test('strips bold markers from standalone lines', () => {
    const body = 'This line has **bold** words in the middle of it.';
    assert.deepEqual(extractFacts(body), ['This line has bold words in the middle of it.']);
  });

  test('de-duplicates identical resulting facts', () => {
    const body = '- Repeated fact here\n- Repeated fact here';
    assert.deepEqual(extractFacts(body), ['Repeated fact here']);
  });

  test('ignores blank lines between content', () => {
    const body = '\n\n- First fact appears here\n\n\n- Second fact appears here\n\n';
    assert.deepEqual(extractFacts(body), ['First fact appears here', 'Second fact appears here']);
  });

  test('mixes headings, bullets, blockquotes, and prose in one body', () => {
    const body = [
      '## Newton\'s Laws',
      'Three fundamental laws describing motion.',
      '- First law: an object at rest stays at rest',
      '- Second law: F = ma',
      '> Every action has an equal and opposite reaction',
    ].join('\n');

    assert.deepEqual(extractFacts(body), [
      'Three fundamental laws describing motion.',
      'First law: an object at rest stays at rest',
      'Second law: F = ma',
      'Every action has an equal and opposite reaction',
    ]);
  });

  test('quirk: blockquote lines keep bold markers (unlike bullets and plain lines)', () => {
    const body = '> This is a **bold** quote';
    assert.deepEqual(extractFacts(body), ['This is a **bold** quote']);
  });

  test('quirk: a 4-hash heading is not recognized as a heading', () => {
    const body = '#### This four-hash line is long enough to qualify';
    assert.deepEqual(extractFacts(body), ['#### This four-hash line is long enough to qualify']);
  });
});
