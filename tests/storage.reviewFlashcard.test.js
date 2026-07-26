// storage.reviewFlashcard.test.js
//
// Covers the SM-2-lite scheduling math in reviewFlashcard(id, grade):
//   - grade < 3 (fail):  interval resets to 0, ease drops by 0.2 (floor 1.3)
//   - grade >= 3 (pass): interval 0->1, 1->3, else round(interval * ease)
//                         ease shifts by (grade - 3) * 0.1 (floor 1.3)
//   - next_review = now + interval_days
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage, flashcard } from './helpers/fixtures.js';
import { reviewFlashcard, getFlashcards } from '../storage.js';

function cardById(id) {
  return getFlashcards().find(c => c.id === id);
}

describe('reviewFlashcard — SM-2-lite scheduling', () => {
  test('failing grade (< 3) resets interval to 0 and lowers ease by 0.2', async () => {
    await resetStorage({ flashcards: [flashcard({ id: 'c1', interval_days: 6, ease: 2.5 })] });

    await reviewFlashcard('c1', 1);

    const c = cardById('c1');
    assert.equal(c.interval_days, 0);
    assert.equal(c.ease, 2.3);
  });

  test('ease never drops below the 1.3 floor, even after repeated failures', async () => {
    await resetStorage({ flashcards: [flashcard({ id: 'c1', interval_days: 0, ease: 1.4 })] });

    await reviewFlashcard('c1', 0); // 1.4 - 0.2 = 1.2 -> floored to 1.3
    assert.equal(cardById('c1').ease, 1.3);

    await reviewFlashcard('c1', 0); // would be 1.1 -> stays floored
    assert.equal(cardById('c1').ease, 1.3);
  });

  test('first successful review (interval 0) schedules a 1-day interval', async () => {
    await resetStorage({ flashcards: [flashcard({ id: 'c1', interval_days: 0, ease: 2.5 })] });
    await reviewFlashcard('c1', 4);
    assert.equal(cardById('c1').interval_days, 1);
  });

  test('second successful review (interval 1) jumps to a 3-day interval regardless of ease', async () => {
    await resetStorage({ flashcards: [flashcard({ id: 'c1', interval_days: 1, ease: 1.9 })] });
    await reviewFlashcard('c1', 5);
    assert.equal(cardById('c1').interval_days, 3);
  });

  test('later successful reviews multiply the interval by ease, rounded to the nearest day', async () => {
    await resetStorage({ flashcards: [flashcard({ id: 'c1', interval_days: 3, ease: 2.5 })] });
    await reviewFlashcard('c1', 4);
    assert.equal(cardById('c1').interval_days, Math.round(3 * 2.5)); // 8
  });

  test('interval multiplication rounds to nearest day (not floor/ceil)', async () => {
    // 4 * 1.35 = 5.4 -> rounds down to 5
    await resetStorage({ flashcards: [flashcard({ id: 'c1', interval_days: 4, ease: 1.35 })] });
    await reviewFlashcard('c1', 3);
    assert.equal(cardById('c1').interval_days, 5);
  });

  test('grade 3 leaves ease unchanged; 4 and 5 nudge it up by 0.1 per point above 3', async () => {
    await resetStorage({
      flashcards: [
        flashcard({ id: 'a', interval_days: 3, ease: 2.5 }),
        flashcard({ id: 'b', interval_days: 3, ease: 2.5 }),
        flashcard({ id: 'c', interval_days: 3, ease: 2.5 }),
      ],
    });

    await reviewFlashcard('a', 3);
    await reviewFlashcard('b', 4);
    await reviewFlashcard('c', 5);

    assert.equal(cardById('a').ease, 2.5);
    assert.equal(cardById('b').ease, 2.6);
    assert.equal(cardById('c').ease, 2.7);
  });

  test('next_review is stamped exactly interval_days ahead of the review time', async () => {
    await resetStorage({ flashcards: [flashcard({ id: 'c1', interval_days: 1, ease: 2.5 })] });

    mock.timers.enable({ apis: ['Date'] });
    try {
      mock.timers.setTime(new Date('2026-03-01T09:30:00.000Z').getTime());

      await reviewFlashcard('c1', 5); // interval 1 -> 3

      const expected = new Date('2026-03-01T09:30:00.000Z');
      expected.setDate(expected.getDate() + 3);
      assert.equal(cardById('c1').next_review, expected.toISOString());
    } finally {
      mock.timers.reset();
    }
  });

  test('failing review reschedules for "today" (interval 0 days out)', async () => {
    await resetStorage({ flashcards: [flashcard({ id: 'c1', interval_days: 5, ease: 2.0 })] });

    mock.timers.enable({ apis: ['Date'] });
    try {
      mock.timers.setTime(new Date('2026-03-01T09:30:00.000Z').getTime());
      await reviewFlashcard('c1', 1);
      assert.equal(cardById('c1').next_review, new Date('2026-03-01T09:30:00.000Z').toISOString());
    } finally {
      mock.timers.reset();
    }
  });

  test('reviewing an unknown flashcard id is a silent no-op, not a throw', async () => {
    await resetStorage({ flashcards: [flashcard({ id: 'c1' })] });
    await assert.doesNotReject(() => reviewFlashcard('does-not-exist', 5));
    assert.equal(getFlashcards().length, 1);
  });
});
