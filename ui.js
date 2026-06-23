// ui.js — tiny DOM helpers shared across modules.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else if (v === true) node.setAttribute(k, '');
    else if (v === false || v == null) {}
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export function renderMarkdownish(body) {
  // Very small renderer: headings (#, ##), bullet lists (- ),
  // callouts (>), inline code, wikilinks [[Title]], bold **x**, italic *x*.
  // Anything else is plain text. Keeps the app dependency-free.
  const lines = (body || '').split('\n');
  const out = [];
  let listOpen = false;
  let para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const closeList = () => { if (listOpen) { out.push('</ul>'); listOpen = false; } };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); closeList(); continue; }
    if (line.startsWith('## ')) { flushPara(); closeList(); out.push(`<div class="heading-2">${inline(line.slice(3))}</div>`); continue; }
    if (line.startsWith('### ')) { flushPara(); closeList(); out.push(`<div class="heading-3">${inline(line.slice(4))}</div>`); continue; }
    if (line.startsWith('> ')) { flushPara(); closeList(); out.push(`<div class="callout"><div class="callout-label">NOTE</div>${inline(line.slice(2))}</div>`); continue; }
    if (/^[-*] /.test(line)) { flushPara(); if (!listOpen) { out.push('<ul class="bullet-list">'); listOpen = true; } out.push(`<li>${inline(line.slice(2))}</li>`); continue; }
    if (line.startsWith('```')) { flushPara(); closeList(); out.push(`<div class="formula">${escapeHtml(line.replace(/```/g, ''))}</div>`); continue; }
    para.push(line);
  }
  flushPara(); closeList();
  return out.join('\n');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  let r = escapeHtml(s);
  r = r.replace(/\[\[([^\]]+)\]\]/g, (_, title) => `<span class="wikilink" data-wikilink="${escapeHtml(title)}">${escapeHtml(title)}</span>`);
  r = r.replace(/`([^`]+)`/g, '<code>$1</code>');
  r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  r = r.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return r;
}

export function formatDate(iso, locale = 'en-US') {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

export function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

export function toast(msg) {
  const host = document.getElementById('toast-host') || (() => {
    const h = el('div', { id: 'toast-host' });
    document.body.appendChild(h);
    return h;
  })();
  const t = el('div', { class: 'toast' }, msg);
  host.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}

// ── Shared right-click context menu ─────────────────────────
// One menu lives at a time; opening a new one closes any other.
let activeCtxMenu = null;

export function closeContextMenu() {
  if (activeCtxMenu) { activeCtxMenu.remove(); activeCtxMenu = null; }
}

// Mounts arbitrary content (built with el()) as a positioned popup menu,
// clamped to the viewport, dismissed on the next outside click.
export function openContextMenu(contentEl, clientX, clientY) {
  closeContextMenu();
  document.body.appendChild(contentEl);
  const vw = window.innerWidth, vh = window.innerHeight;
  const rect = contentEl.getBoundingClientRect();
  contentEl.style.left = Math.min(clientX, vw - rect.width - 8) + 'px';
  contentEl.style.top = Math.min(clientY, vh - rect.height - 8) + 'px';
  activeCtxMenu = contentEl;
  setTimeout(() => window.addEventListener('click', closeContextMenu, { once: true }), 0);
}

// Convenience builder for the common case: a title plus a simple list of
// text actions. items: [{ label, danger?, onClick }]
export function contextMenuItems(title, items) {
  return el('div', { class: 'ctx-menu' }, [
    el('div', { class: 'ctx-menu-title' }, title),
    ...items.map(it => el('div', {
      class: 'ctx-menu-item' + (it.danger ? ' ctx-menu-danger' : ''),
      onclick: () => { closeContextMenu(); it.onClick(); },
    }, it.label)),
  ]);
}
