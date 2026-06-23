// tests.js — quiz taking, scoring, attempts; flashcards with SM-2-lite.
import { getTests, getAttempts, createTest, deleteTest, recordAttempt, getFlashcards, getDueFlashcards, createFlashcard, reviewFlashcard, deleteFlashcard } from './storage.js';
import { el, $, clear, toast } from './ui.js';
import { aiGenerateQuiz } from './ai.js';

let activeTest = null;
let activeIndex = 0;
let answers = [];

export async function initTests() {
  renderTestList();
  renderFlashcards();
  $('#new-test-btn')?.addEventListener('click', onNewTest);
  $('#new-card-btn')?.addEventListener('click', onNewCard);
  window.__openTest = openTest;
}

function renderTestList() {
  const host = $('#tests-list');
  if (!host) return;
  clear(host);
  const tests = getTests();
  if (!tests.length) {
    host.appendChild(el('div', { class: 'empty-state' }, 'No tests yet. Click "New test" or generate one from a material.'));
    return;
  }
  for (const t of tests) {
    const attempts = getAttempts().filter(a => a.test_id === t.id);
    const best = attempts.length ? Math.max(...attempts.map(a => a.score)) : null;
    const card = el('div', { class: 'test-card' }, [
      el('div', { class: 'test-card-title' }, t.title),
      el('div', { class: 'test-card-meta' }, [
        el('span', {}, t.subject || 'General'),
        el('span', {}, `${(t.items || []).length} questions`),
        el('span', {}, `${attempts.length} attempts`),
        best != null ? el('span', { class: 'test-best' }, `Best: ${best}%`) : null,
      ]),
      el('div', { class: 'test-card-actions' }, [
        el('button', { class: 'btn-primary', onclick: () => openTest(t.id) }, 'Take'),
        el('button', { class: 'btn-ghost', onclick: () => { if (confirm('Delete test?')) { deleteTest(t.id); renderTestList(); } } }, 'Delete'),
      ]),
    ]);
    host.appendChild(card);
  }
}

async function onNewTest() {
  const subject = $('#test-subject-input')?.value.trim() || 'General';
  const title = $('#test-title-input')?.value.trim() || 'New test';
  toast('Generating test…');
  // Grounded in the note hierarchy: aiGenerateQuiz looks for a node titled
  // `title` (or matching subject) and pulls facts from its whole subtree.
  const items = await aiGenerateQuiz(title || subject);
  const t = await createTest({ subject, title, items });
  renderTestList();
  openTest(t.id);
}

export function openTest(id) {
  const t = getTests().find(x => x.id === id);
  if (!t) return;
  activeTest = t;
  activeIndex = 0;
  answers = new Array(t.items.length).fill(null);
  showTestRunner();
  switchToPanel('tests');
}

function showTestRunner() {
  const host = $('#test-runner');
  if (!host || !activeTest) return;
  clear(host);
  host.style.display = 'block';
  const t = activeTest;
  const item = t.items[activeIndex];
  const answered = answers.filter(a => a != null).length;
  const total = t.items.length;

  const header = el('div', { class: 'test-runner-header' }, [
    el('div', { class: 'test-runner-title' }, t.title),
    el('div', { class: 'test-runner-progress' }, `Question ${activeIndex + 1} of ${total} · Answered ${answered}`),
    el('button', { class: 'btn-ghost', onclick: () => { activeTest = null; host.style.display = 'none'; } }, 'Close'),
  ]);

  const q = el('div', { class: 'test-runner-q' }, item.q);
  const opts = el('div', { class: 'test-runner-opts' });
  item.opts.forEach((o, i) => {
    const opt = el('div', {
      class: 'test-runner-opt' + (answers[activeIndex] === i ? ' selected' : ''),
      onclick: () => { answers[activeIndex] = i; showTestRunner(); },
    }, `${String.fromCharCode(65 + i)}. ${o}`);
    opts.appendChild(opt);
  });

  const nav = el('div', { class: 'test-runner-nav' }, [
    el('button', { class: 'btn-ghost', onclick: () => { if (activeIndex > 0) { activeIndex--; showTestRunner(); } } }, '← Prev'),
    activeIndex < total - 1
      ? el('button', { class: 'btn-primary', onclick: () => { activeIndex++; showTestRunner(); } }, 'Next →')
      : el('button', {
          class: 'btn-primary',
          onclick: () => finishTest(),
        }, 'Submit'),
  ]);

  host.append(header, q, opts, nav);
}

async function finishTest() {
  const t = activeTest;
  let correct = 0;
  t.items.forEach((it, i) => { if (answers[i] === it.answer) correct++; });
  const score = Math.round((correct / t.items.length) * 100);
  await recordAttempt(t.id, answers, score);
  activeTest = null;
  const host = $('#test-runner');
  clear(host);
  host.appendChild(el('div', { class: 'test-result' }, [
    el('div', { class: 'test-result-score' }, `${score}%`),
    el('div', {}, `${correct} of ${t.items.length} correct`),
    el('button', { class: 'btn-ghost', onclick: () => { host.style.display = 'none'; } }, 'Done'),
  ]));
  renderTestList();
  toast(`Score: ${score}%`);
}

function renderFlashcards() {
  const host = $('#flashcards-list');
  if (!host) return;
  clear(host);
  const due = getDueFlashcards();
  $('#flashcards-due') && ($('#flashcards-due').textContent = String(due.length));
  const all = getFlashcards();
  if (!all.length) {
    host.appendChild(el('div', { class: 'empty-state' }, 'No flashcards yet.'));
    return;
  }
  for (const c of all) {
    const card = el('div', { class: 'flashcard-card' }, [
      el('div', { class: 'flashcard-front' }, c.front),
      el('div', { class: 'flashcard-back' }, c.back),
      el('div', { class: 'flashcard-meta' }, [
        el('span', {}, c.subject || 'General'),
        el('span', {}, `next: ${new Date(c.next_review).toLocaleDateString()}`),
        el('button', { class: 'btn-ghost', onclick: () => { if (confirm('Delete card?')) { deleteFlashcard(c.id); renderFlashcards(); } } }, 'Delete'),
      ]),
    ]);
    if (due.find(d => d.id === c.id)) {
      const review = el('div', { class: 'flashcard-review' }, ['Hard', 'Good', 'Easy'].map((g, i) =>
        el('button', { class: 'btn-ghost', onclick: async () => { await reviewFlashcard(c.id, i + 2); renderFlashcards(); } }, g)
      ));
      card.appendChild(review);
    }
    host.appendChild(card);
  }
}

async function onNewCard() {
  const front = $('#card-front-input')?.value.trim();
  const back = $('#card-back-input')?.value.trim();
  const subject = $('#card-subject-input')?.value.trim() || 'General';
  if (!front || !back) { toast('Front and back required'); return; }
  await createFlashcard({ front, back, subject });
  $('#card-front-input').value = '';
  $('#card-back-input').value = '';
  renderFlashcards();
}

function switchToPanel(name) {
  window.__showSecondaryPanel?.(name);
}

export function refreshTests() { renderTestList(); renderFlashcards(); }
