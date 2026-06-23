// search.js — Ctrl+K command palette.
// Searches all notes by title and body content. Results are ranked:
// title matches first, then body matches. Shows a highlighted snippet
// for body matches. Keyboard-navigable (↑↓ Enter Esc).
import { getNotes } from './storage.js';
import { el, $ } from './ui.js';

const MAX_RESULTS = 8;
const TYPE_LABEL  = { subject: 'SUB', topic: 'TOP', subtopic: 'SUBT', note: 'N' };

let overlay   = null;
let openNoteCb = null;
let selectedIdx = 0;
let currentResults = [];

// ── Public API ────────────────────────────────────────────────
export function initSearch(openNoteCallback) {
  openNoteCb = openNoteCallback;

  // Ctrl+K / Cmd+K global shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); toggle(); }
    if (e.key === 'Escape' && overlay) close();
  });

  // Topbar button
  $('#btn-search')?.addEventListener('click', () => toggle());
}

// ── Open / close ──────────────────────────────────────────────
function toggle() { overlay ? close() : open(); }

function open() {
  if (overlay) return;

  const input = el('input', {
    class: 'search-input',
    type: 'text',
    placeholder: 'Search notes…',
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const resultsList = el('div', { class: 'search-results' });

  const modal = el('div', { class: 'search-modal' }, [
    el('div', { class: 'search-input-row' }, [
      el('span', { class: 'search-icon' }, [
        svgSearch(),
      ]),
      input,
      el('span', { class: 'search-esc-hint' }, 'Esc'),
    ]),
    resultsList,
  ]);

  overlay = el('div', { class: 'search-overlay' }, [modal]);

  // Click the dark backdrop (not the modal) to dismiss
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

  document.body.appendChild(overlay);
  renderResults('', resultsList);
  input.focus();

  input.addEventListener('input', () => {
    selectedIdx = 0;
    renderResults(input.value, resultsList);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1, resultsList); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1, resultsList); }
    else if (e.key === 'Enter')  { e.preventDefault(); openSelected(); }
    else if (e.key === 'Escape') { close(); }
  });
}

function close() {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  currentResults = [];
  selectedIdx = 0;
}

// ── Keyboard navigation ───────────────────────────────────────
function move(delta, list) {
  if (!currentResults.length) return;
  selectedIdx = (selectedIdx + delta + currentResults.length) % currentResults.length;
  updateSelection(list);
}

function updateSelection(list) {
  const items = list.querySelectorAll('.search-result');
  items.forEach((item, i) => item.classList.toggle('selected', i === selectedIdx));
  items[selectedIdx]?.scrollIntoView({ block: 'nearest' });
}

function openSelected() {
  const note = currentResults[selectedIdx];
  if (note) { close(); openNoteCb(note.id); }
}

// ── Search logic ──────────────────────────────────────────────
function search(query) {
  const notes = getNotes();
  if (!query.trim()) {
    // Empty query: show the 8 most-recently-updated notes
    return notes.slice(0, MAX_RESULTS).map(n => ({ note: n, matchField: 'recent', snippet: '' }));
  }
  const q = query.trim().toLowerCase();
  const results = [];
  for (const n of notes) {
    const titleIdx = (n.title || '').toLowerCase().indexOf(q);
    const bodyIdx  = (n.body  || '').toLowerCase().indexOf(q);
    if (titleIdx !== -1) {
      results.push({ note: n, matchField: 'title', titleIdx, snippet: '', score: 0 });
    } else if (bodyIdx !== -1) {
      results.push({ note: n, matchField: 'body', bodyIdx, snippet: makeSnippet(n.body, bodyIdx, q.length), score: 1 });
    }
  }
  results.sort((a, b) => a.score - b.score);
  return results.slice(0, MAX_RESULTS);
}

// Extract ~80 chars of context around the match in the body
function makeSnippet(body, idx, matchLen) {
  const start = Math.max(0, idx - 35);
  const end   = Math.min(body.length, idx + matchLen + 45);
  let snip = body.slice(start, end).replace(/\n+/g, ' ').trim();
  if (start > 0) snip = '…' + snip;
  if (end < body.length) snip = snip + '…';
  return snip;
}

// Wrap the matching portion of a string in a <mark> element
function highlight(text, query) {
  if (!query || !query.trim()) return [document.createTextNode(text)];
  const idx = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (idx === -1) return [document.createTextNode(text)];
  const before = text.slice(0, idx);
  const match  = text.slice(idx, idx + query.trim().length);
  const after  = text.slice(idx + query.trim().length);
  const mark   = el('mark', { class: 'search-highlight' }, match);
  return [document.createTextNode(before), mark, document.createTextNode(after)];
}

// ── Rendering ─────────────────────────────────────────────────
function renderResults(query, list) {
  while (list.firstChild) list.removeChild(list.firstChild);

  const results = search(query);
  currentResults = results.map(r => r.note);

  if (!results.length) {
    list.appendChild(el('div', { class: 'search-empty' }, query ? `No notes matching "${query}"` : 'Your vault is empty'));
    return;
  }

  results.forEach((r, i) => {
    const { note, matchField, snippet } = r;
    const titleNodes = matchField === 'title' ? highlight(note.title || 'Untitled', query) : [document.createTextNode(note.title || 'Untitled')];

    const titleEl = el('span', { class: 'search-result-title' });
    titleNodes.forEach(n => titleEl.appendChild(n));

    const children = [
      el('div', { class: 'search-result-left' }, [
        el('div', { class: 'sb-item-dot', style: { background: note.color || '#6F00FF', flexShrink: '0' } }),
        el('span', { class: 'sb-item-type' }, TYPE_LABEL[note.type || 'note'] || 'N'),
        titleEl,
      ]),
      el('div', { class: 'search-result-meta' }, note.subject || 'General'),
    ];

    if (snippet) {
      const snippetEl = el('div', { class: 'search-result-snippet' });
      highlight(snippet, query).forEach(n => snippetEl.appendChild(n));
      children.push(snippetEl);
    }

    const item = el('div', {
      class: 'search-result' + (i === selectedIdx ? ' selected' : ''),
      onmouseenter: () => { selectedIdx = i; updateSelection(list); },
      onclick: () => { close(); openNoteCb(note.id); },
    }, children);

    list.appendChild(item);
  });
}

// ── Inline SVG icon ───────────────────────────────────────────
function svgSearch() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('width', '14'); s.setAttribute('height', '14');
  s.setAttribute('viewBox', '0 0 14 14'); s.setAttribute('fill', 'none');
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '6'); circle.setAttribute('cy', '6'); circle.setAttribute('r', '4');
  circle.setAttribute('stroke', 'currentColor'); circle.setAttribute('stroke-width', '1.4');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', '9.2'); line.setAttribute('y1', '9.2');
  line.setAttribute('x2', '12.5'); line.setAttribute('y2', '12.5');
  line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '1.4');
  line.setAttribute('stroke-linecap', 'round');
  s.appendChild(circle); s.appendChild(line);
  return s;
}
