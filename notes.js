// notes.js — Obsidian-like notes: CRUD, wikilinks, editable editor.
// Notes are typed nodes (subject/topic/subtopic/note) arranged in a
// hierarchy via parent_id; the sidebar renders that tree, and the editor
// lets you reclassify a node's type/parent at any time.
import {
  getNotes, getNote, getNoteLinks, getNoteByTitle,
  createNote, updateNote, deleteNote,
  getChildren, getDescendants, getAncestors, validParentTypesFor, migrateNotesToHierarchy,
  getSettings,
} from './storage.js';
import { triggerAutoSuggest } from './ai-suggest.js';import { el, $, $$, clear, renderMarkdownish, formatDate, toast, openContextMenu, contextMenuItems } from './ui.js';

let activeId = null;
let saveTimer = null;
let openTabs = [];
let modeSwitchCb = null;

// ── Sidebar customization state (quick filter text + collapsed node ids) ──
let sidebarFilter = '';
const COLLAPSE_KEY = 'adastra.sidebarCollapsed';
let collapsed = loadCollapsed();

function loadCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); } catch { return new Set(); }
}
function saveCollapsed() {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed])); } catch {}
}
function toggleCollapse(id) {
  if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
  saveCollapsed();
  renderList();
}
function collapseAll() {
  collapsed = new Set(getNotes().filter(n => getChildren(n.id).length > 0).map(n => n.id));
  saveCollapsed();
  renderList();
}
function expandAll() {
  collapsed = new Set();
  saveCollapsed();
  renderList();
}
function sortNodes(nodes, sortMode) {
  const arr = nodes.slice();
  if (sortMode === 'updated') arr.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  else arr.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  return arr;
}
function wordCount(text) {
  const words = (text.trim().match(/\S+/g) || []).length;
  return `${words} word${words === 1 ? '' : 's'} · ${text.length} chars`;
}

const TYPE_BADGE = { subject: 'SUB', topic: 'TOP', subtopic: 'SUBT', note: 'N' };

// Called by app.js so that opening a note (from the Vault list, a
// wikilink, or the Graph) always brings the Notes panel into view, even
// though Notes is no longer its own top-level mode button.
export function setModeSwitchCallback(fn) { modeSwitchCb = fn; }

export async function initNotes() {
  // One-time (idempotent) upgrade of any flat/legacy notes into a real
  // Subject > ... > Note hierarchy based on their old `subject` field.
  await migrateNotesToHierarchy();

  activeId = getNotes()[0]?.id || null;
  if (activeId) openTab(activeId);
  renderList();
  renderProgress();

  $('#editor-content').addEventListener('input', onEditorInput);
  $('#editor-content').addEventListener('click', onEditorClick);
  $('#editor-tabs').addEventListener('click', onTabsClick);
  $$('.tab-close').forEach(x => x.addEventListener('click', e => { e.stopPropagation(); }));

  $('#sidebar-filter-input')?.addEventListener('input', (e) => { sidebarFilter = e.target.value; renderList(); });
  $('#btn-collapse-all')?.addEventListener('click', collapseAll);
  $('#btn-expand-all')?.addEventListener('click', expandAll);
}

export function activeNoteId() { return activeId; }
export function getActiveNote() { return activeId ? getNote(activeId) : null; }
export function getOpenTabs() { return openTabs.slice(); }

export function renderList() {
  const list = $('#note-list');
  if (!list) return;
  clear(list);

  const settings = getSettings();
  const sortMode = settings.sidebarOpts?.sort || 'name';
  const query = sidebarFilter.trim().toLowerCase();

  // While filtering, show matches plus their ancestors (for context) —
  // everything else is hidden rather than dimmed, so the tree stays short.
  let visibleIds = null;
  if (query) {
    visibleIds = new Set();
    for (const n of getNotes()) {
      if ((n.title || '').toLowerCase().includes(query)) {
        visibleIds.add(n.id);
        for (const a of getAncestors(n.id)) visibleIds.add(a.id);
      }
    }
  }

  const renderNode = (n, depth) => {
    if (visibleIds && !visibleIds.has(n.id)) return;
    const kidCount = getChildren(n.id).length;
    const isOpen = query ? true : !collapsed.has(n.id);
    const descCount = getDescendants(n.id).length;

    const chevron = kidCount
      ? el('span', {
          class: 'sb-item-chevron' + (isOpen ? ' open' : ''),
          onclick: (e) => { e.stopPropagation(); toggleCollapse(n.id); },
        }, '▸')
      : el('span', { class: 'sb-item-chevron spacer' });

    const item = el('div', {
      class: 'sb-item' + (n.id === activeId ? ' active' : ''),
      style: { paddingLeft: (12 + depth * 14) + 'px' },
      onclick: () => openTab(n.id),
    }, [
      chevron,
      el('div', { class: 'sb-item-dot', style: { background: n.color || '#6F00FF' } }),
      el('span', { class: 'sb-item-type' }, TYPE_BADGE[n.type || 'note'] || 'N'),
      el('span', {}, n.title || 'Untitled'),
      descCount ? el('span', { class: 'sb-item-count' }, String(descCount)) : null,
    ].filter(Boolean));

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(contextMenuItems(`${n.title || 'Untitled'} · ${n.type || 'note'}`, [
        { label: 'Open', onClick: () => openTab(n.id) },
        { label: 'Rename', onClick: () => {
          const v = prompt('Rename', n.title || '');
          if (v && v.trim() && v.trim() !== n.title) { updateNote(n.id, { title: v.trim() }).then(renderList); }
        } },
        { label: 'Duplicate', onClick: () => duplicateNote(n) },
        { label: 'Delete', danger: true, onClick: () => {
          if (!confirm(`Delete "${n.title || 'Untitled'}"? Child nodes will be unlinked.`)) return;
          deleteNote(n.id).then(() => {
            closeTab(n.id);
            const remaining = getNotes();
            if (remaining.length) openTab(remaining[0].id);
            else { activeId = null; }
            renderList();
          });
        } },
      ]), e.clientX, e.clientY);
    });
    list.appendChild(item);
    if (kidCount && isOpen) {
      for (const child of sortNodes(getChildren(n.id), sortMode)) renderNode(child, depth + 1);
    }
  };

  const subjects = sortNodes(getNotes().filter(n => (n.type || 'note') === 'subject'), sortMode);
  for (const s of subjects) renderNode(s, 0);
  // Safety net: anything without a parent that isn't itself a Subject
  // (shouldn't normally happen once migrateNotesToHierarchy has run).
  const orphans = getNotes().filter(n => !n.parent_id && (n.type || 'note') !== 'subject');
  for (const o of orphans) renderNode(o, 0);

  if (query && visibleIds && visibleIds.size === 0) {
    list.appendChild(el('div', { class: 'empty-state' }, `No notes matching "${sidebarFilter.trim()}"`));
  }

  $('#stat-notes').textContent = String(getNotes().length);
  const linkCount = getNoteLinks().length;
  const linkStat = $('.sb-stat:nth-child(2) .sb-stat-num');
  if (linkStat) linkStat.textContent = String(linkCount);
  renderProgress();
}

async function duplicateNote(n) {
  const copy = await createNote({
    type: n.type,
    parent_id: n.parent_id,
    title: (n.title || 'Untitled') + ' (copy)',
    subject: n.subject,
    body: n.body,
    color: n.color,
    tags: n.tags,
  });
  renderList();
  openTab(copy.id);
  toast(`Duplicated "${n.title || 'Untitled'}"`);
}

function renderProgress() {
  // Per-subject % = unique linked notes / total notes in subject, capped.
  const notes = getNotes();
  const links = getNoteLinks();
  const subjects = {};
  for (const n of notes) {
    const s = n.subject || 'General';
    if (!subjects[s]) subjects[s] = { total: 0, linked: new Set() };
    subjects[s].total++;
  }
  for (const l of links) {
    const src = getNote(l.source);
    if (src) {
      const s = src.subject || 'General';
      if (subjects[s]) subjects[s].linked.add(src.id);
    }
  }
  const host = $('#subject-progress');
  if (!host) return;
  clear(host);
  for (const [name, data] of Object.entries(subjects)) {
    const pct = Math.min(100, Math.round((data.linked.size / Math.max(1, data.total)) * 100));
    host.appendChild(el('div', { class: 'sb-progress' }, [
      `${name}`,
      el('div', { class: 'sb-prog-bar' }, el('div', { class: 'sb-prog-fill', style: { width: pct + '%' } })),
    ]));
  }
}

export function openTab(id) {
  if (!id) return;
  modeSwitchCb?.();
  if (!openTabs.includes(id)) openTabs.push(id);
  activeId = id;
  renderTabs();
  renderEditor();
  renderList();
}

// Registers the tab and renders the editor WITHOUT switching the primary
// view away from graph. Used when creating a node from the graph canvas —
// the note is queued so opening it later (click/shortcut) works instantly,
// but the user stays on the graph.
export function registerTabSilent(id) {
  if (!id) return;
  if (!openTabs.includes(id)) openTabs.push(id);
  activeId = id;
  // Render editor in the background so it's ready, but don't call
  // modeSwitchCb — that's what would flip the view to Notes.
  renderTabs();
  renderEditor();
  renderList();
}

export function focusNoteBody() {
  requestAnimationFrame(() => {
    const body = document.querySelector('#note-display .note-body');
    if (body) { body.focus(); body.selectionStart = body.selectionEnd = body.value.length; }
  });
}

export function closeTab(id) {
  openTabs = openTabs.filter(t => t !== id);
  if (activeId === id) activeId = openTabs[openTabs.length - 1] || null;
  renderTabs();
  renderEditor();
  renderList();
}

function renderTabs() {
  const host = $('#editor-tabs');
  clear(host);
  for (const id of openTabs) {
    const n = getNote(id);
    if (!n) continue;
    const isActive = id === activeId;
    const tab = el('div', {
      class: 'tab' + (isActive ? ' active' : ''),
      onclick: () => { activeId = id; renderTabs(); renderEditor(); renderList(); },
    }, [
      el('div', { class: 'tab-dot', style: { background: n.color || '#6F00FF' } }),
      el('span', {}, n.title || 'Untitled'),
      el('span', {
        class: 'tab-close',
        onclick: (e) => { e.stopPropagation(); closeTab(id); },
      }, '×'),
    ]);
    host.appendChild(tab);
  }
}

// Candidates a node of `type` is allowed to be parented under, excluding
// itself and its own descendants (no cycles).
function validParentCandidates(type, excludeId) {
  const wanted = validParentTypesFor(type);
  if (!wanted.length) return [];
  const blocked = new Set([excludeId, ...getDescendants(excludeId).map(d => d.id)]);
  return getNotes().filter(n => wanted.includes(n.type || 'note') && !blocked.has(n.id));
}

function renderEditor() {
  const display = $('#note-display');
  clear(display);
  if (!activeId) {
    display.appendChild(el('div', { class: 'empty-state' }, 'Select a note or create a new one.'));
    return;
  }
  const note = getNote(activeId);
  if (!note) return;
  const titleInput = el('div', {
    class: 'note-title',
    contenteditable: 'true',
    oninput: (e) => scheduleSave({ title: e.target.textContent.trim() || 'Untitled' }),
  }, note.title || 'Untitled');
  const tags = (note.tags || []).map(t => el('span', { class: 'note-tag' }, '#' + t));

  const typeSel = el('select', {
    class: 'note-subject',
    onchange: (e) => {
      const newType = e.target.value;
      // Changing type invalidates the old parent unless it's still valid.
      const stillValid = validParentTypesFor(newType).includes(getNote(note.parent_id)?.type);
      updateNote(note.id, { type: newType, parent_id: stillValid ? note.parent_id : null });
      renderEditor(); renderList();
    },
  }, ['subject', 'topic', 'subtopic', 'note'].map(ty =>
    el('option', { value: ty, ...(ty === (note.type || 'note') ? { selected: 'selected' } : {}) }, ty[0].toUpperCase() + ty.slice(1))));

  const parentCandidates = validParentCandidates(note.type || 'note', note.id);
  const parentSel = (note.type || 'note') === 'subject' ? null : el('select', {
    class: 'note-subject',
    onchange: async (e) => {
      const pid = e.target.value || null;
      const parent = pid ? getNote(pid) : null;
      await updateNote(note.id, { parent_id: pid, subject: parent ? (parent.type === 'subject' ? parent.title : parent.subject) : note.subject });
      renderEditor(); renderList();
    },
  }, [
    el('option', { value: '' }, '— no parent —'),
    ...parentCandidates.map(p => el('option', { value: p.id, ...(p.id === note.parent_id ? { selected: 'selected' } : {}) }, `[${p.type}] ${p.title}`)),
  ]);

  const colorSel = el('input', {
    type: 'color',
    class: 'note-color',
    value: note.color || '#6F00FF',
    onchange: (e) => { updateNote(note.id, { color: e.target.value }); renderList(); renderEditor(); toast('Color updated'); },
  });
  const addTagInput = el('input', {
    class: 'add-tag-input',
    placeholder: '+ tag',
    onkeydown: (e) => {
      if (e.key === 'Enter' && e.target.value.trim()) {
        const t = e.target.value.trim().replace(/^#/, '');
        const tags = [...(note.tags || []), t];
        updateNote(note.id, { tags });
        e.target.value = '';
        renderEditor();
      }
    },
  });
  const removeTag = (i) => (e) => {
    e.stopPropagation();
    const tags = (note.tags || []).filter((_, j) => j !== i);
    updateNote(note.id, { tags });
    renderEditor();
  };
  tags.forEach((node, i) => node.addEventListener('click', removeTag(i)));

  const metaChildren = [
    el('span', {}, formatDate(note.updated_at || note.created_at)),
    el('span', { class: 'note-word-count' }, wordCount(note.body || '')),
    el('span', { class: 'note-save-status' }, 'Saved'),
    el('div', { class: 'note-tags-row' }, [...tags, addTagInput]),
    typeSel,
  ];
  if (parentSel) metaChildren.push(parentSel);
  metaChildren.push(colorSel);
  const meta = el('div', { class: 'note-meta' }, metaChildren);

  const body = el('textarea', {
    class: 'note-body',
    placeholder: 'Write your note. Use [[Title]] to link to another note.',
  });
  body.value = note.body || '';

  const preview = el('div', { class: 'note-preview', html: renderMarkdownish(note.body || '') });

  const deleteBtn = el('button', {
    class: 'btn-danger',
    onclick: async () => {
      if (!confirm('Delete this note? Child nodes will be unlinked, not deleted.')) return;
      await deleteNote(note.id);
      closeTab(note.id);
      const remaining = getNotes();
      if (remaining.length) openTab(remaining[0].id);
      else { activeId = null; renderEditor(); renderTabs(); }
      renderList();
    },
  }, 'Delete');

  const toolbar = el('div', { class: 'note-toolbar' }, [
    el('button', {
      class: 'btn-ghost',
      onclick: () => { preview.innerHTML = renderMarkdownish(body.value); },
    }, 'Refresh preview'),
    el('button', {
      class: 'btn-ghost btn-ai-chat',
      onclick: () => {
        const bodySnippet = (note.body || '').slice(0, 600);
        const prompt = `Let's discuss my "${note.title}" note (${note.type || 'note'} in ${note.subject || 'General'}).\n\nHere's what I have:\n\n${bodySnippet}${note.body && note.body.length > 600 ? '\n…' : ''}\n\nWhat questions should I be able to answer about this? What am I missing?`;
        window.__prefillAiChat?.(prompt);
      },
    }, '✦ Chat about this'),
    deleteBtn,
  ]);

  display.append(titleInput, meta, body, toolbar, preview);
}

function scheduleSave(patch) {
  if (!activeId) return;
  const status = document.querySelector('.note-save-status');
  if (status) { status.textContent = 'Saving…'; status.classList.add('saving'); }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await updateNote(activeId, patch);
    renderList();
    if ('title' in patch) renderTabs();
    const status2 = document.querySelector('.note-save-status');
    if (status2) { status2.textContent = 'Saved'; status2.classList.remove('saving'); }
  }, 400);
}

function onEditorInput(e) {
  const t = e.target;
  if (t.classList.contains('note-title')) scheduleSave({ title: t.textContent.trim() || 'Untitled' });
  if (t.classList.contains('note-body')) {
    scheduleSave({ body: t.value });
    const wc = document.querySelector('.note-word-count');
    if (wc) wc.textContent = wordCount(t.value);
  }
}

function onEditorClick(e) {
  const wl = e.target.closest('.wikilink');
  if (!wl) return;
  const title = wl.dataset.wikilink;
  const target = getNoteByTitle(title);
  if (target) openTab(target.id);
  else {
    (async () => {
      const created = await createNote({ title, body: '' });
      renderList();
      openTab(created.id);
      toast('Created new note: ' + title);
    })();
  }
}

function onTabsClick(e) {
  const close = e.target.closest('.tab-close');
  if (!close) return;
  const tab = close.closest('.tab');
  if (!tab) return;
  // tab has no data attr in the dynamic render; use openTabs index by text
  const idx = [...tab.parentElement.children].indexOf(tab);
  const id = openTabs[idx];
  if (id) closeTab(id);
}

export async function addNote() {
  const note = await createNote({ title: 'New Note', body: '## New Note\n\nStart writing. Use [[Other Note]] to link.', subject: 'General' });
  renderList();
  openTab(note.id);
  // AI auto-suggest siblings after sidebar note creation
  triggerAutoSuggest(note);
}
