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

// ── Accessibility helpers ──────────────────────────────────────
// Makes a non-button element (div/span used as a clickable row, toggle,
// swatch, etc.) keyboard-operable: focusable, announced as `role`, and
// activated by Enter/Space in addition to click. Use this any time a div
// carries an onclick handler instead of a real <button>.
export function makeActivatable(node, { role = 'button', onActivate, label } = {}) {
  if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '0');
  if (role) node.setAttribute('role', role);
  if (label) node.setAttribute('aria-label', label);
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      (onActivate || (() => node.click()))(e);
    }
  });
  return node;
}

// Simple focus trap for modal dialogs / menus: Tab cycles within
// `container`'s focusable descendants, Escape invokes `onEscape`.
export function trapFocus(container, onEscape) {
  function focusable() {
    return $$('a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])', container)
      .filter(n => n.offsetParent !== null || n === document.activeElement);
  }
  function onKeydown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); onEscape?.(); return; }
    if (e.key !== 'Tab') return;
    const items = focusable();
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  container.addEventListener('keydown', onKeydown);
  return () => container.removeEventListener('keydown', onKeydown);
}

// Opens a modal dialog: marks up ARIA, traps focus, remembers the
// previously-focused element, and focuses the first field. `dialogEl`
// should be the element that should carry role="dialog" (usually the
// `.modal` box, not the backdrop). Returns a close() function that
// restores focus and runs any extra cleanup.
export function openModal(backdropEl, dialogEl, { labelledBy, describedBy, initialFocus, onClose } = {}) {
  const previouslyFocused = document.activeElement;
  dialogEl.setAttribute('role', 'dialog');
  dialogEl.setAttribute('aria-modal', 'true');
  if (labelledBy) dialogEl.setAttribute('aria-labelledby', labelledBy);
  if (describedBy) dialogEl.setAttribute('aria-describedby', describedBy);
  if (!document.body.contains(backdropEl)) document.body.appendChild(backdropEl);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    untrap();
    if (backdropEl.isConnected) backdropEl.remove();
    onClose?.();
    // Restore focus to whatever triggered the modal (button, etc.)
    previouslyFocused?.focus?.();
  };

  const untrap = trapFocus(dialogEl, close);

  const toFocus = initialFocus || $('input,textarea,select,button', dialogEl);
  requestAnimationFrame(() => toFocus?.focus());

  return close;
}

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
let ctxReturnFocus = null;
let ctxUntrap = null;

export function closeContextMenu() {
  if (!activeCtxMenu) return;
  ctxUntrap?.();
  ctxUntrap = null;
  activeCtxMenu.remove();
  activeCtxMenu = null;
  ctxReturnFocus?.focus?.();
  ctxReturnFocus = null;
}

// Mounts arbitrary content (built with el()) as a positioned popup menu,
// clamped to the viewport, dismissed on the next outside click, Escape,
// or after choosing an item. Focus moves into the menu and returns to
// whatever triggered it (typically the right-clicked row) on close.
export function openContextMenu(contentEl, clientX, clientY) {
  closeContextMenu();
  if (!contentEl.hasAttribute('role')) contentEl.setAttribute('role', 'menu');
  contentEl.setAttribute('tabindex', '-1');
  document.body.appendChild(contentEl);
  const vw = window.innerWidth, vh = window.innerHeight;
  const rect = contentEl.getBoundingClientRect();
  contentEl.style.left = Math.min(clientX, vw - rect.width - 8) + 'px';
  contentEl.style.top = Math.min(clientY, vh - rect.height - 8) + 'px';
  activeCtxMenu = contentEl;
  ctxReturnFocus = document.activeElement;
  ctxUntrap = trapFocus(contentEl, closeContextMenu);

  // Arrow-key navigation between menu items (including color swatches,
  // which use role="menuitemradio").
  contentEl.addEventListener('keydown', (e) => {
    const items = $$('[role^="menuitem"]', contentEl);
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1 + items.length) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
  });

  const firstItem = $('[role^="menuitem"]', contentEl);
  requestAnimationFrame(() => (firstItem || contentEl).focus());

  setTimeout(() => window.addEventListener('click', closeContextMenu, { once: true }), 0);
}

// Convenience builder for the common case: a title plus a simple list of
// text actions. items: [{ label, danger?, onClick }]
export function contextMenuItems(title, items) {
  const titleId = 'ctx-title-' + Math.random().toString(36).slice(2, 9);
  return el('div', { class: 'ctx-menu', role: 'menu', 'aria-labelledby': titleId }, [
    el('div', { class: 'ctx-menu-title', id: titleId }, title),
    ...items.map(it => el('div', {
      class: 'ctx-menu-item' + (it.danger ? ' ctx-menu-danger' : ''),
      role: 'menuitem',
      tabindex: '-1',
      onclick: () => { closeContextMenu(); it.onClick(); },
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeContextMenu(); it.onClick(); }
      },
    }, it.label)),
  ]);
}
