// materials.js — study materials per subject.
// "Sync from notes" builds/updates a digest material per Subject node by
// pulling facts straight out of that subject's note hierarchy, so the
// material actually reflects what the user wrote — including small things.
import { getMaterials, createMaterial, updateMaterial, deleteMaterial, getSubjectNodes, createTest, getTests } from './storage.js';
import { el, $, clear, toast } from './ui.js';
import { aiGenerateQuiz, gatherFactsForTopic } from './ai.js';

const DIGEST_PREFIX = 'Notes digest: ';

export async function initMaterials() {
  bindToolbar();
  renderMaterials();
}

function bindToolbar() {
  $('#add-material-btn')?.addEventListener('click', async () => {
    const subject = $('#material-subject-input')?.value.trim() || 'General';
    const title = $('#material-title-input')?.value.trim();
    const content = $('#material-content-input')?.value.trim();
    if (!title) { toast('Title required'); return; }
    await createMaterial({ subject, title, kind: 'article', content });
    $('#material-title-input').value = '';
    $('#material-content-input').value = '';
    renderMaterials();
  });

  const body = $('#add-material-btn')?.parentElement;
  if (body && !$('#sync-materials-btn')) {
    const syncBtn = el('button', {
      id: 'sync-materials-btn',
      class: 'btn-ghost',
      style: { marginTop: '6px' },
      onclick: syncMaterialsFromNotes,
    }, '↻ Sync from notes');
    $('#add-material-btn').insertAdjacentElement('afterend', syncBtn);
  }
}

// Builds (or refreshes) one digest material per Subject node, summarizing
// facts pulled from every note under that subject. AI here means: extract
// what the user actually wrote and keep the digest current with it.
export async function syncMaterialsFromNotes() {
  const subjects = getSubjectNodes();
  if (!subjects.length) { toast('No subjects in your graph yet — create one in Graph view.'); return; }
  let created = 0, updated = 0;
  for (const s of subjects) {
    const facts = gatherFactsForTopic(s.title);
    if (!facts.length) continue;
    const title = DIGEST_PREFIX + s.title;
    const content = facts.slice(0, 30).map(f => `• ${f.fact}  [${f.source}]`).join('\n');
    const existing = getMaterials().find(m => m.title === title && m.subject === s.title);
    if (existing) {
      if (existing.content !== content) { await updateMaterial(existing.id, { content }); updated++; }
    } else {
      await createMaterial({ subject: s.title, title, kind: 'summary', content });
      created++;
    }
  }
  renderMaterials();
  if (!created && !updated) toast('Materials already match your notes.');
  else toast(`Synced from notes — ${created} new, ${updated} updated.`);
}

function renderMaterials() {
  const host = $('#materials-list');
  if (!host) return;
  clear(host);
  const mats = getMaterials();
  if (!mats.length) {
    host.appendChild(el('div', { class: 'empty-state' }, 'No materials yet. Add one above, or sync from your notes.'));
    return;
  }
  for (const m of mats) {
    const card = el('div', { class: 'material-card' }, [
      el('div', { class: 'material-card-header' }, [
        el('span', { class: 'material-subject' }, m.subject),
        el('span', { class: 'material-kind' }, m.kind),
      ]),
      el('div', { class: 'material-title' }, m.title),
      el('div', { class: 'material-content' }, m.content || ''),
      el('div', { class: 'material-actions' }, [
        el('button', {
          class: 'btn-primary',
          onclick: async () => {
            toast('Generating quiz…');
            const items = await aiGenerateQuiz(m.title.replace(DIGEST_PREFIX, '') || m.subject);
            await createTest({ subject: m.subject, title: `Quiz: ${m.title.replace(DIGEST_PREFIX, '')}`, items });
            renderMaterials();
            const tests = getTests();
            const last = tests[tests.length - 1];
            if (last && window.__openTest) window.__openTest(last.id);
            toast('Quiz ready');
          },
        }, 'Generate quiz'),
        el('button', {
          class: 'btn-ghost',
          onclick: async () => {
            if (!confirm(`Delete "${m.title}"?`)) return;
            await deleteMaterial(m.id);
            renderMaterials();
          },
        }, 'Delete'),
      ]),
    ]);
    host.appendChild(card);
  }
}

export function refreshMaterials() { renderMaterials(); }
