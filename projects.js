// projects.js — the project hub (index.html).
//
// Each Ad Astra project is a fully isolated vault: its own notes/links,
// its own graph canvas layout (positions + pan/zoom), and its own sidebar
// collapse state. Isolation is done by namespacing localStorage keys with
// the project's id (see the matching comments in storage.js/graph.js/
// notes.js). Project 'default' keeps the original unsuffixed keys, so
// anyone upgrading from the single-vault version of Ad Astra keeps their
// existing data as "My Vault" with zero migration steps.
//
// Opening a project navigates to app.html?project=<id> — a real page
// load, not an in-page route change — which is what guarantees each
// project's JS module state (graph positions, open tabs, AI history…)
// starts completely clean instead of leaking between projects.
import { el, $, clear, toast, openModal } from './ui.js';

const PROJECTS_KEY = 'adastra.projects';
const LS_BASE       = 'nexuslearn.v2';
const POS_BASE      = 'nexuslearn.graphPositions';
const VIEW_BASE     = 'nexuslearn.graphView';
const COLLAPSE_BASE = 'adastra.sidebarCollapsed';

const keyFor = (base, id) => (id === 'default' ? base : `${base}.${id}`);
const lsKeyFor        = (id) => keyFor(LS_BASE, id);
const posKeyFor        = (id) => keyFor(POS_BASE, id);
const viewKeyFor       = (id) => keyFor(VIEW_BASE, id);
const collapseKeyFor   = (id) => keyFor(COLLAPSE_BASE, id);

const PALETTE = ['#6F00FF', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#4ADE80', '#38BDF8'];
let filterText = '';

// ── Registry (list of projects) ───────────────────────────────
function loadRegistry() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]'); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  if (!list.find(p => p.id === 'default')) {
    const now = new Date().toISOString();
    list.unshift({ id: 'default', name: 'My Vault', color: PALETTE[0], createdAt: now, updatedAt: now });
    saveRegistry(list);
  }
  return list;
}
function saveRegistry(list) {
  try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(list)); } catch {}
}

// ── Reading a project's raw data (without loading the whole app) ──
function readProjectData(id) {
  try {
    const raw = localStorage.getItem(lsKeyFor(id));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function projectStats(id) {
  const data = readProjectData(id);
  if (!data || !Array.isArray(data.notes)) return { subjects: 0, notes: 0 };
  const subjects = data.notes.filter(n => (n.type || 'note') === 'subject').length;
  return { subjects, notes: data.notes.length };
}

// ── CRUD ────────────────────────────────────────────────────────
function createProject(name, color) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const list = loadRegistry();
  list.push({ id, name: (name || 'Untitled Project').trim() || 'Untitled Project', color: color || PALETTE[Math.floor(Math.random() * PALETTE.length)], createdAt: now, updatedAt: now });
  saveRegistry(list);
  return id;
}

function renameProject(id, name) {
  const list = loadRegistry();
  const p = list.find(x => x.id === id);
  if (!p) return;
  p.name = name.trim() || p.name;
  p.updatedAt = new Date().toISOString();
  saveRegistry(list);
  render();
}

function deleteProject(id) {
  const list = loadRegistry().filter(p => p.id !== id);
  saveRegistry(list);
  localStorage.removeItem(lsKeyFor(id));
  localStorage.removeItem(posKeyFor(id));
  localStorage.removeItem(viewKeyFor(id));
  localStorage.removeItem(collapseKeyFor(id));
  render();
}

function duplicateProject(id) {
  const src = loadRegistry().find(p => p.id === id);
  const data = localStorage.getItem(lsKeyFor(id));
  const pos  = localStorage.getItem(posKeyFor(id));
  const view = localStorage.getItem(viewKeyFor(id));
  const newId = crypto.randomUUID();
  if (data) localStorage.setItem(lsKeyFor(newId), data);
  if (pos)  localStorage.setItem(posKeyFor(newId), pos);
  if (view) localStorage.setItem(viewKeyFor(newId), view);
  const now = new Date().toISOString();
  const list = loadRegistry();
  list.push({ id: newId, name: `${src?.name || 'Project'} (copy)`, color: src?.color || PALETTE[0], createdAt: now, updatedAt: now });
  saveRegistry(list);
  render();
  toast(`Duplicated "${src?.name || 'Project'}"`);
}

function openProject(id) {
  location.href = `app.html?project=${encodeURIComponent(id)}`;
}

// ── Export / Import (a full project — data + layout — as one file) ──
function exportProject(id) {
  const meta = loadRegistry().find(p => p.id === id);
  const data = readProjectData(id) || { notes: [], note_links: [], graph_objects: [] };
  let positions = null, view = null;
  try { positions = JSON.parse(localStorage.getItem(posKeyFor(id)) || 'null'); } catch {}
  try { view = JSON.parse(localStorage.getItem(viewKeyFor(id)) || 'null'); } catch {}
  const payload = { kind: 'ad-astra-project', version: 1, exported_at: new Date().toISOString(), project: meta, data, positions, view };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ad-astra-project-${(meta?.name || 'project').replace(/\s+/g, '_')}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Project exported');
}

async function importProjectFile(file) {
  let payload;
  try { payload = JSON.parse(await file.text()); } catch { toast('That file is not valid JSON'); return; }
  const data = payload?.data || payload; // tolerate a raw graph export too
  if (!data || !Array.isArray(data.notes)) { toast('That file doesn\'t look like an Ad Astra project export'); return; }

  const id = crypto.randomUUID();
  localStorage.setItem(lsKeyFor(id), JSON.stringify(data));
  if (payload.positions) localStorage.setItem(posKeyFor(id), JSON.stringify(payload.positions));
  if (payload.view) localStorage.setItem(viewKeyFor(id), JSON.stringify(payload.view));

  const now = new Date().toISOString();
  const list = loadRegistry();
  list.push({
    id,
    name: payload.project?.name ? `${payload.project.name} (imported)` : 'Imported Project',
    color: payload.project?.color || PALETTE[Math.floor(Math.random() * PALETTE.length)],
    createdAt: now,
    updatedAt: now,
  });
  saveRegistry(list);
  render();
  toast('Project imported');
}

// ── Modals ────────────────────────────────────────────────────
function openNameModal({ title, initial = '', confirmLabel = 'Create', onConfirm }) {
  const host = $('#modal-host');
  clear(host);
  const titleId = 'name-modal-title';
  const input = el('input', { class: 'input', placeholder: 'Project name', value: initial, 'aria-label': 'Project name' });
  const err = el('div', { class: 'modal-sub', role: 'alert' }, '');
  const swatches = [];
  const colorRow = el('div', { class: 'set-color-row', role: 'radiogroup', 'aria-label': 'Project color' },
    PALETTE.map((c, i) => {
      const sw = el('div', {
        class: 'set-color-swatch' + (i === 0 ? ' selected' : ''),
        style: { background: c },
        role: 'radio',
        tabindex: i === 0 ? '0' : '-1',
        'aria-checked': i === 0 ? 'true' : 'false',
        'aria-label': 'Color ' + c,
      });
      const select = () => {
        swatches.forEach(s => { s.classList.remove('selected'); s.setAttribute('aria-checked', 'false'); s.setAttribute('tabindex', '-1'); });
        sw.classList.add('selected');
        sw.setAttribute('aria-checked', 'true');
        sw.setAttribute('tabindex', '0');
      };
      sw.addEventListener('click', select);
      sw.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); swatches[(i + 1) % swatches.length].focus(); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); swatches[(i - 1 + swatches.length) % swatches.length].focus(); }
      });
      swatches.push(sw);
      return sw;
    })
  );
  const confirmBtn = el('button', { class: 'btn-primary' }, confirmLabel);
  const cancelBtn = el('button', { class: 'btn-ghost' }, 'Cancel');
  const close = () => closeModalFocus();
  confirmBtn.addEventListener('click', () => {
    const name = input.value.trim();
    if (!name) { err.textContent = 'Name required'; return; }
    const selected = colorRow.querySelector('.set-color-swatch.selected');
    const color = selected ? selected.style.background : PALETTE[0];
    close();
    onConfirm(name, rgbToHex(color));
  });
  cancelBtn.addEventListener('click', close);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmBtn.click(); });

  const closeBtn = el('span', { class: 'modal-close', role: 'button', tabindex: '0', 'aria-label': 'Close dialog', onclick: close }, '×');
  closeBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(); } });

  const modalBox = el('div', { class: 'modal' }, [
    el('div', { class: 'modal-title-row' }, [
      el('div', { class: 'modal-title', id: titleId }, title),
      closeBtn,
    ]),
    input, colorRow, err,
    el('div', { style: { display: 'flex', gap: '8px', marginTop: '4px' } }, [confirmBtn, cancelBtn]),
  ]);
  const backdrop = el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, [modalBox]);
  host.appendChild(backdrop);
  const closeModalFocus = openModal(backdrop, modalBox, { labelledBy: titleId, initialFocus: input });
  input.select();
}

// Browsers report computed colors as rgb(...); PALETTE entries are already
// hex, so this just passes them straight through when style.background
// echoes the hex string back (most browsers keep the literal we set).
function rgbToHex(color) {
  if (color.startsWith('#')) return color;
  const m = color.match(/\d+/g);
  if (!m) return PALETTE[0];
  return '#' + m.slice(0, 3).map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join('');
}

// ── Rendering ─────────────────────────────────────────────────
function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function render() {
  const grid = $('#projects-grid');
  if (!grid) return;
  clear(grid);

  let list = loadRegistry().slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  if (filterText) list = list.filter(p => (p.name || '').toLowerCase().includes(filterText));

  if (!list.length) {
    grid.appendChild(el('div', { class: 'projects-empty' }, `No projects matching "${filterText}"`));
  } else {
    for (const p of list) {
      const stats = projectStats(p.id);
      const card = el('div', {
        class: 'project-card',
        onclick: () => openProject(p.id),
      }, [
        el('div', { class: 'project-card-top' }, [
          el('div', { class: 'project-card-dot', style: { background: p.color || PALETTE[0] } }),
          el('div', { class: 'project-card-name' }, p.name || 'Untitled Project'),
        ]),
        el('div', { class: 'project-card-stats' }, `${stats.subjects} subject${stats.subjects === 1 ? '' : 's'} · ${stats.notes} node${stats.notes === 1 ? '' : 's'}`),
        el('div', { class: 'project-card-updated' }, `Updated ${relativeTime(p.updatedAt)}`),
        el('div', { class: 'project-card-actions', onclick: (e) => e.stopPropagation() }, [
          el('button', { class: 'btn-ghost', onclick: () => openNameModal({
            title: 'Rename project', initial: p.name, confirmLabel: 'Save',
            onConfirm: (name) => renameProject(p.id, name),
          }) }, 'Rename'),
          el('button', { class: 'btn-ghost', onclick: () => duplicateProject(p.id) }, 'Duplicate'),
          el('button', { class: 'btn-ghost', onclick: () => exportProject(p.id) }, 'Export'),
          el('button', { class: 'btn-danger', onclick: () => {
            if (confirm(`Delete "${p.name || 'this project'}"? This permanently removes its notes, graph, and progress. This can't be undone.`)) deleteProject(p.id);
          } }, 'Delete'),
        ]),
      ]);
      grid.appendChild(card);
    }
  }

  // "+ New project" card always shown, filter or not
  grid.appendChild(el('div', {
    class: 'project-card project-card-new',
    onclick: () => openNameModal({
      title: 'New project', confirmLabel: 'Create',
      onConfirm: (name, color) => openProject(createProject(name, color)),
    }),
  }, [
    el('div', { class: 'project-card-new-icon' }, '+'),
    el('div', {}, 'New project'),
  ]));
}

// ── Bootstrap ─────────────────────────────────────────────────
function bindToolbar() {
  $('#projects-search')?.addEventListener('input', (e) => { filterText = e.target.value.trim().toLowerCase(); render(); });
  $('#btn-import-project')?.addEventListener('click', () => $('#import-file-input')?.click());
  $('#import-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await importProjectFile(file);
  });
}

bindToolbar();
render();
