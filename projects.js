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
// ── Accounts ─────────────────────────────────────────────────────────
// When Supabase is configured, this page now REQUIRES sign-in and the
// project *list itself* lives in a `projects` table scoped to `user_id` —
// so signing in as a different account shows that account's projects,
// not whatever's cached in this browser. When Supabase isn't configured
// at all, there's no login wall and the original shared-local-vault
// behavior is preserved exactly.
//
// Opening a project navigates to app.html?project=<id> — a real page
// load, not an in-page route change — which is what guarantees each
// project's JS module state (graph positions, open tabs, AI history…)
// starts completely clean instead of leaking between projects.
import { el, $, clear, toast, openModal } from './ui.js';
import { requireAuth, signOutAndRedirect, getSupabaseClient } from './auth.js';

const PROJECTS_KEY = 'adastra.projects'; // local-mode-only registry
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

let authState = null;    // { user, local }
let supabase  = null;    // Supabase client, or null in local mode
let registryCache = [];  // in-memory list of {id,name,color,createdAt,updatedAt}

// ── Local-mode registry (unchanged — single shared vault, no accounts) ─
function loadLocalRegistry() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]'); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  if (!list.find(p => p.id === 'default')) {
    const now = new Date().toISOString();
    list.unshift({ id: 'default', name: 'My Vault', color: PALETTE[0], createdAt: now, updatedAt: now });
    saveLocalRegistry(list);
  }
  return list;
}
function saveLocalRegistry(list) {
  try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(list)); } catch {}
}

// Per-account offline cache, namespaced by user id, so switching accounts
// in the same browser never flashes another account's project list if
// Supabase is briefly unreachable.
const cacheKeyFor = (uid) => `adastra.projects.cache.${uid}`;
function loadAccountCache(uid) {
  try { return JSON.parse(localStorage.getItem(cacheKeyFor(uid)) || '[]'); } catch { return []; }
}
function saveAccountCache(uid, list) {
  try { localStorage.setItem(cacheKeyFor(uid), JSON.stringify(list)); } catch {}
}

function rowToProject(row) {
  return { id: row.id, name: row.name, color: row.color, createdAt: row.created_at, updatedAt: row.updated_at };
}

// ── Registry loading (forks on auth mode) ──────────────────────
async function loadRegistry() {
  if (authState.local) return loadLocalRegistry();
  const uid = authState.user.id;
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', uid)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    const list = (data || []).map(rowToProject);
    saveAccountCache(uid, list);
    return list;
  } catch (err) {
    console.warn('Failed to load projects from Supabase, showing offline cache', err);
    toast('Could not reach the server — showing your last known projects.');
    return loadAccountCache(uid);
  }
}

// ── Reading a project's raw local data (for the stat line on each card) ──
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

// ── CRUD (forks on auth mode) ───────────────────────────────────
async function createProject(name, color) {
  const finalName = (name || 'Untitled Project').trim() || 'Untitled Project';
  const finalColor = color || PALETTE[Math.floor(Math.random() * PALETTE.length)];

  if (authState.local) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const list = loadLocalRegistry();
    list.push({ id, name: finalName, color: finalColor, createdAt: now, updatedAt: now });
    saveLocalRegistry(list);
    return id;
  }

  const uid = authState.user.id;
  const { data, error } = await supabase
    .from('projects')
    .insert({ user_id: uid, name: finalName, color: finalColor })
    .select()
    .single();
  if (error) { toast('Could not create project: ' + error.message); throw error; }
  registryCache = [rowToProject(data), ...registryCache];
  saveAccountCache(uid, registryCache);
  return data.id;
}

async function renameProject(id, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return;
  if (authState.local) {
    const list = loadLocalRegistry();
    const p = list.find(x => x.id === id);
    if (!p) return;
    p.name = trimmed;
    p.updatedAt = new Date().toISOString();
    saveLocalRegistry(list);
  } else {
    const { error } = await supabase.from('projects').update({ name: trimmed, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast('Rename failed: ' + error.message); return; }
  }
  await refresh();
}

async function deleteProject(id) {
  if (authState.local) {
    saveLocalRegistry(loadLocalRegistry().filter(p => p.id !== id));
  } else {
    // FK cascade on the `projects` table (see SQL migration) removes the
    // project's notes/tests/etc. rows in Supabase automatically.
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) { toast('Delete failed: ' + error.message); return; }
  }
  localStorage.removeItem(lsKeyFor(id));
  localStorage.removeItem(posKeyFor(id));
  localStorage.removeItem(viewKeyFor(id));
  localStorage.removeItem(collapseKeyFor(id));
  await refresh();
}

async function duplicateProject(id) {
  const src  = registryCache.find(p => p.id === id);
  const data = localStorage.getItem(lsKeyFor(id));
  const pos  = localStorage.getItem(posKeyFor(id));
  const view = localStorage.getItem(viewKeyFor(id));
  const newId = await createProject(`${src?.name || 'Project'} (copy)`, src?.color);
  if (data) localStorage.setItem(lsKeyFor(newId), data);
  if (pos)  localStorage.setItem(posKeyFor(newId), pos);
  if (view) localStorage.setItem(viewKeyFor(newId), view);
  await refresh();
  toast(`Duplicated "${src?.name || 'Project'}"`);
}

function openProject(id) {
  location.href = `app.html?project=${encodeURIComponent(id)}`;
}

async function refresh() {
  registryCache = await loadRegistry();
  render();
}

// ── Export / Import (a full project — data + layout — as one file) ──
function exportProject(id) {
  const meta = registryCache.find(p => p.id === id);
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

  const id = await createProject(
    payload.project?.name ? `${payload.project.name} (imported)` : 'Imported Project',
    payload.project?.color
  );
  localStorage.setItem(lsKeyFor(id), JSON.stringify(data));
  if (payload.positions) localStorage.setItem(posKeyFor(id), JSON.stringify(payload.positions));
  if (payload.view) localStorage.setItem(viewKeyFor(id), JSON.stringify(payload.view));

  await refresh();
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
  confirmBtn.addEventListener('click', async () => {
    const name = input.value.trim();
    if (!name) { err.textContent = 'Name required'; return; }
    const selected = colorRow.querySelector('.set-color-swatch.selected');
    const color = selected ? rgbToHex(selected.style.background) : PALETTE[0];
    confirmBtn.disabled = true;
    try {
      await onConfirm(name, color);
    } finally {
      confirmBtn.disabled = false;
    }
    close();
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

// ── User bar (email + sign out) ─────────────────────────────────
function renderUserBar() {
  const host = document.getElementById('projects-user-bar');
  if (!host) return;
  clear(host);
  if (authState.local) { host.style.display = 'none'; return; }
  host.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;margin-top:12px;';
  host.appendChild(el('span', { style: { fontSize: '12px', color: 'var(--text-muted)' } }, authState.user.email || ''));
  host.appendChild(el('button', {
    class: 'tb-btn',
    onclick: () => signOutAndRedirect('login.html'),
  }, 'Sign out'));
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

  let list = registryCache.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  if (filterText) list = list.filter(p => (p.name || '').toLowerCase().includes(filterText));

  if (!list.length) {
    grid.appendChild(el('div', { class: 'projects-empty' }, filterText ? `No projects matching "${filterText}"` : 'No projects yet — create your first one below.'));
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
      onConfirm: async (name, color) => openProject(await createProject(name, color)),
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

async function init() {
  authState = await requireAuth('login.html');
  if (!authState) return; // requireAuth already redirected to login.html
  supabase = authState.local ? null : await getSupabaseClient();
  renderUserBar();
  bindToolbar();
  await refresh();
}

init();
