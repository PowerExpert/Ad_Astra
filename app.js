// app.js — bootstrap, mode switch, settings wiring, auth UI, AI panel.
import { initStorage, isLocalMode, getCurrentUser, onAuthChange, signIn, signUp, signOut, getSettings, updateSettings, getTests, getNotes, getNoteLinks } from './storage.js';
import { initNotes, openTab, addNote, renderList, setModeSwitchCallback } from './notes.js';
import { startGraph, stopGraph, setOpts, setOpenNoteCallback, bindGraphShortcuts } from './graph.js';
import { aiChat } from './ai.js';
import { initMaterials } from './materials.js';
import { initTests, refreshTests } from './tests.js';
import { el, $, $$, clear, formatDate, toast, daysUntil } from './ui.js';
import { AI_CONFIG } from './config.js';
import { initSearch } from './search.js';

// Two independent tab groups:
//  - primary:   'notes' | 'graph'                — exactly one always shown.
//    Notes is the default/fallback and can't be closed by clicking it
//    again. Graph replaces Notes when opened, and toggles back to Notes
//    if clicked again while already active.
//  - secondary: null | 'materials' | 'tests' | 'flashcards' — at most one
//    shown, sits between primary content and the AI panel. Clicking the
//    already-active one closes it, letting primary content expand back
//    into that space.
// The Vault sidebar and AI panel are never touched by either group.
let primaryMode = 'notes';
let secondaryMode = null;
let graphRunning = false;

window.__toggleSettings = function() { $('#settings-panel').classList.toggle('open'); };

document.addEventListener('click', (e) => {
  const panel = $('#settings-panel');
  const trigger = $('#btn-settings');
  if (panel.classList.contains('open') && !panel.contains(e.target) && !trigger.contains(e.target)) {
    panel.classList.remove('open');
  }
});

async function bootstrap() {
  await initStorage();
  const user = getCurrentUser();
  setAvatar(user);

  setModeSwitchCallback(() => setPrimary('notes'));
  initNotes();
  await initMaterials();
  await initTests();

  setOpenNoteCallback(openTab);

  bindModeButtons();
  bindSettings();
  bindAiPanel();
  bindAuthButtons();
  bindAddNote();
  initSearch(openTab);

  // Let any module pre-fill the AI input (e.g. "Chat about this note" button).
  // Sets the value, scrolls the AI panel into view, and focuses the input
  // so the user can edit before sending.
  window.__prefillAiChat = (text) => {
    const input = $('#ai-input-field');
    if (!input) return;
    input.value = text;
    input.focus();
    // Scroll the AI panel messages to bottom so context is visible
    const msgs = $('#ai-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  };

  applySettingsToUi(getSettings());
  showBannerIfNeeded();
  applyLayout();

  // Global keyboard shortcuts
  bindGraphShortcuts();
  bindShortcutHelp();

  if (!isLocalMode() && !user.email) {
    renderAuthModal(true);
  }

  // Initial AI greeting
  pushAiMsg('assistant', `Welcome to Ad Astra. ${isLocalMode() ? 'Running in local mode — set Supabase and AI keys in config.js to enable sync and real AI.' : `Signed in as ${user.email}.`}`, { type: 'insight' });
}

function setAvatar(user) {
  const a = $('#tb-avatar');
  a.textContent = (user.email || '·').charAt(0).toUpperCase();
}

function showBannerIfNeeded() {
  const banner = $('#banner');
  if (isLocalMode()) {
    banner.classList.add('warn');
    banner.style.display = 'flex';
    $('#banner-text').textContent = 'Local mode — data stays in this browser. Configure Supabase + AI in config.js to enable sync and real AI.';
  } else if (!AI_CONFIG.apiKey) {
    banner.style.display = 'flex';
    $('#banner-text').textContent = 'Supabase connected, but AI key is empty. AI panel uses heuristic responses until AI_CONFIG.apiKey is set.';
  } else {
    banner.style.display = 'none';
  }
}

function bindModeButtons() {
  $$('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (btn.dataset.group === 'primary') setPrimary(mode);
      else setSecondary(mode);
    });
  });
}

// Notes: always sets primary to notes (idempotent — pressing it again
// while already on notes does nothing visible).
// Graph: toggles — press once to open (replacing Notes, which keeps its
// already-saved content since note edits autosave independent of which
// tab is showing), press again while open to return to Notes.
function setPrimary(mode) {
  if (mode === 'graph') primaryMode = (primaryMode === 'graph') ? 'notes' : 'graph';
  else primaryMode = 'notes';
  applyLayout();
}

// Materials/Tests/Cards: clicking the active one closes it (back to null,
// letting primary content reclaim the space); clicking a different one
// switches directly.
function setSecondary(mode) {
  secondaryMode = (secondaryMode === mode) ? null : mode;
  applyLayout();
}

// Force-opens a secondary panel without the close-on-repeat-click
// behavior — used for programmatic navigation (e.g. jumping to a
// freshly generated quiz), where the intent is always "show this."
function showSecondary(mode) {
  secondaryMode = mode;
  applyLayout();
}
window.__showSecondaryPanel = showSecondary;

function applyLayout() {
  $('#editor').style.display = primaryMode === 'notes' ? 'flex' : 'none';
  $('#graph-view').style.display = primaryMode === 'graph' ? 'block' : 'none';
  if (primaryMode === 'graph' && !graphRunning) { startGraph(); graphRunning = true; }
  else if (primaryMode !== 'graph' && graphRunning) { stopGraph(); graphRunning = false; }

  const secondaryPanels = { materials: '#materials-view', tests: '#tests-view', flashcards: '#flashcards-view' };
  for (const [name, sel] of Object.entries(secondaryPanels)) {
    $(sel)?.classList.toggle('active', secondaryMode === name);
  }
  if (secondaryMode === 'flashcards') refreshTests();

  $$('.mode-btn').forEach(b => {
    const active = b.dataset.group === 'primary' ? b.dataset.mode === primaryMode : b.dataset.mode === secondaryMode;
    b.classList.toggle('active', active);
  });
}

function bindSettings() {
  $$('.set-color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      $$('.set-color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      const c = sw.dataset.accent, b = sw.dataset.bright;
      document.documentElement.style.setProperty('--violet', c);
      document.documentElement.style.setProperty('--violet-bright', b);
      document.documentElement.style.setProperty('--violet-glow', c + '26');
      updateSettings({ accent: c, accentBright: b });
    });
  });
  $('#font-size-slider')?.addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    $('#editor-content').style.fontSize = v + 'px';
    updateSettings({ fontSize: v });
  });
  $('#font-family-select')?.addEventListener('change', e => {
    $('#editor-content').style.fontFamily = e.target.value;
    updateSettings({ fontFamily: e.target.value });
  });
  const tog = (id, cb) => { const el = $('#' + id); el?.addEventListener('click', () => { cb(el.classList.toggle('on')); }); };
  tog('tog-labels', v => { setOpts({ labels: v }); updateSettings({ graphOpts: { ...getSettings().graphOpts, labels: v } }); startGraph(); });
  tog('tog-auto', v => updateSettings({ aiOpts: { ...getSettings().aiOpts, autoAnalyze: v } }));
  tog('tog-quiz', v => updateSettings({ aiOpts: { ...getSettings().aiOpts, showQuiz: v } }));
  tog('tog-exam', v => updateSettings({ aiOpts: { ...getSettings().aiOpts, examCountdown: v } }));

  // Light mode toggle — persisted to localStorage independently of Supabase settings
  const lightToggle = $('#tog-light');
  if (lightToggle) {
    const applyTheme = (light) => {
      document.documentElement.classList.toggle('light', light);
      lightToggle.classList.toggle('on', light);
      localStorage.setItem('adastra.theme', light ? 'light' : 'dark');
    };
    // Restore from last session
    applyTheme(localStorage.getItem('adastra.theme') === 'light');
    lightToggle.addEventListener('click', () => applyTheme(!document.documentElement.classList.contains('light')));
  }

  $('#graph-node-size')?.addEventListener('input', e => { const v = parseInt(e.target.value, 10); setOpts({ nodeSize: v }); updateSettings({ graphOpts: { ...getSettings().graphOpts, nodeSize: v } }); startGraph(); });
  $('#graph-link-strength')?.addEventListener('input', e => { const v = parseInt(e.target.value, 10); setOpts({ linkStrength: v }); updateSettings({ graphOpts: { ...getSettings().graphOpts, linkStrength: v } }); startGraph(); });

  $('#exam-date-input')?.addEventListener('change', e => { updateSettings({ examDate: e.target.value }); updateExamCountdown(); });

  tog('addon-pomodoro', v => updateSettings({ addons: { ...getSettings().addons, pomodoro: v } }));
  tog('addon-sr', v => updateSettings({ addons: { ...getSettings().addons, spacedRep: v } }));
  tog('addon-exam', v => updateSettings({ addons: { ...getSettings().addons, examSim: v } }));
  tog('addon-mm', v => updateSettings({ addons: { ...getSettings().addons, mindMap: v } }));
}

function applySettingsToUi(s) {
  if (!s) return;
  if (s.accent) {
    document.documentElement.style.setProperty('--violet', s.accent);
    document.documentElement.style.setProperty('--violet-bright', s.accentBright || s.accent);
    document.documentElement.style.setProperty('--violet-glow', s.accent + '26');
  }
  if (s.fontSize) $('#font-size-slider').value = s.fontSize, $('#editor-content').style.fontSize = s.fontSize + 'px';
  if (s.fontFamily) $('#font-family-select').value = s.fontFamily, $('#editor-content').style.fontFamily = s.fontFamily;
  if (s.graphOpts) setOpts(s.graphOpts);
  if (s.examDate) { $('#exam-date-input').value = s.examDate; updateExamCountdown(); }
  // Init toggles from opts
  const t = (id, v) => { const e = $('#' + id); if (e) e.classList.toggle('on', !!v); };
  t('tog-labels', s.graphOpts?.labels);
  t('tog-auto', s.aiOpts?.autoAnalyze);
  t('tog-quiz', s.aiOpts?.showQuiz);
  t('tog-exam', s.aiOpts?.examCountdown);
}

function updateExamCountdown() {
  const s = getSettings();
  const days = daysUntil(s.examDate);
  const host = $('#exam-countdown');
  if (!host) return;
  if (days == null) host.textContent = 'No exam date set';
  else if (days < 0) host.textContent = `Exam passed (${-days} days ago)`;
  else host.textContent = `Exam in ${days} day${days === 1 ? '' : 's'}`;
  $('#stat-tests') && ($('#stat-tests').textContent = String(getTests().length));
}

function bindAddNote() {
  $('#add-note-btn')?.addEventListener('click', addNote);
}

function bindAiPanel() {
  // Conversation history so follow-up questions work correctly
  const history = [];

  const send = async () => {
    const input = $('#ai-input-field');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.disabled = true;
    $('#ai-send-btn').disabled = true;

    pushAiMsg('user', text);
    history.push({ role: 'user', content: text });

    if (!AI_CONFIG.apiKey) {
      // No key → heuristic, no streaming
      const typing = pushTyping();
      const r = await aiChat(history);
      typing.remove();
      pushAiMsg('assistant', r.content, r.error ? { type: 'error' } : null);
      history.push({ role: 'assistant', content: r.content });
    } else {
      // Real model → stream tokens into a live bubble
      const bubble = pushAiMsg('assistant', '');
      const textNode = document.createTextNode('');
      bubble.appendChild(textNode);
      let full = '';

      const r = await aiChat(history, {
        onToken: (chunk) => {
          full += chunk;
          textNode.textContent = full;
          const host = $('#ai-messages');
          if (host) host.scrollTop = host.scrollHeight;
        },
      });

      if (r.error) {
        textNode.textContent = r.content;
        bubble.classList.add('ai-error');
      }
      history.push({ role: 'assistant', content: r.content });
    }

    input.disabled = false;
    $('#ai-send-btn').disabled = false;
    input.focus();
  };

  $('#ai-send-btn')?.addEventListener('click', send);
  $('#ai-input-field')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
}

function pushAiMsg(role, text, opts = {}) {
  const host = $('#ai-messages');
  const cls = role === 'user' ? 'ai-msg ai-msg-user' : (opts.type === 'insight' ? 'ai-msg ai-insight' : (opts.type === 'error' ? 'ai-msg ai-error' : 'ai-msg'));
  const label = role === 'user' ? 'YOU' : (opts.type === 'insight' ? 'INSIGHT' : 'AD ASTRA AI');
  const div = el('div', { class: cls }, [
    el('div', { class: 'ai-msg-label' }, [el('div', { class: 'ai-msg-label-dot' }), label]),
    document.createTextNode(text),
  ]);
  host.appendChild(div);
  host.scrollTop = host.scrollHeight;
  return div;
}

function pushTyping() {
  const host = $('#ai-messages');
  const t = el('div', { class: 'ai-typing' });
  t.appendChild(el('div', { class: 'ai-typing-dot' }));
  t.appendChild(el('div', { class: 'ai-typing-dot' }));
  t.appendChild(el('div', { class: 'ai-typing-dot' }));
  host.appendChild(t);
  host.scrollTop = host.scrollHeight;
  return t;
}

function bindAuthButtons() {
  $('#btn-auth')?.addEventListener('click', () => renderAuthModal(true));
  $('#btn-signout')?.addEventListener('click', async () => { await signOut(); toast('Signed out'); setAvatar(getCurrentUser()); $('#btn-signout').style.display = 'none'; $('#btn-auth').style.display = ''; });
  onAuthChange((u) => {
    setAvatar(u);
    $('#btn-signout').style.display = u.email ? '' : 'none';
    $('#btn-auth').style.display = u.email ? 'none' : '';
    if (u.email) $('#auth-modal-host').innerHTML = '';
  });
  // Initial visibility
  const u = getCurrentUser();
  if (u.email) { $('#btn-signout').style.display = ''; $('#btn-auth').style.display = 'none'; }
  else if (!isLocalMode()) { $('#btn-signout').style.display = 'none'; $('#btn-auth').style.display = ''; }
}

function renderAuthModal(visible) {
  const host = $('#auth-modal-host');
  if (!visible) { host.innerHTML = ''; return; }
  clear(host);
  const mode = { kind: 'signin' };
  const draw = () => {
    clear(host);
    const email = el('input', { class: 'input', type: 'email', placeholder: 'Email' });
    const pw = el('input', { class: 'input', type: 'password', placeholder: 'Password' });
    const submit = el('button', { class: 'btn-primary' }, mode.kind === 'signin' ? 'Sign in' : 'Sign up');
    const switcher = el('button', { class: 'btn-ghost' }, mode.kind === 'signin' ? 'Need an account?' : 'Have an account?');
    const err = el('div', { class: 'modal-sub' }, '');
    const closeBtn = el('span', { class: 'modal-close', onclick: () => { host.innerHTML = ''; } }, '×');
    submit.addEventListener('click', async () => {
      err.textContent = '';
      const r = mode.kind === 'signin' ? await signIn(email.value, pw.value) : await signUp(email.value, pw.value);
      if (r.error) err.textContent = r.error;
      else { toast(mode.kind === 'signin' ? 'Signed in' : 'Check your email'); host.innerHTML = ''; }
    });
    switcher.addEventListener('click', () => { mode.kind = mode.kind === 'signin' ? 'signup' : 'signin'; draw(); });
    const backdrop = el('div', {
      class: 'modal-backdrop',
      onclick: (e) => { if (e.target === backdrop) host.innerHTML = ''; },
    }, [
      el('div', { class: 'modal' }, [
        el('div', { class: 'modal-title-row' }, [
          el('div', { class: 'modal-title' }, 'Sign in to Ad Astra'),
          closeBtn,
        ]),
        el('div', { class: 'modal-sub' }, 'Your notes and progress sync across devices.'),
        email, pw, err, submit, switcher,
      ])
    ]);
    host.appendChild(backdrop);
  };
  draw();
}

// ── Keyboard shortcut help overlay (press ?) ──────────────────
function bindShortcutHelp() {
  const SHORTCUTS = [
    { keys: 'Ctrl + 1',  desc: 'Create Subject node at viewport centre' },
    { keys: 'Ctrl + 2',  desc: 'Create Topic node at viewport centre' },
    { keys: 'Ctrl + 3',  desc: 'Create Subtopic node at viewport centre' },
    { keys: 'Ctrl + 4',  desc: 'Create Note node at viewport centre' },
    { keys: 'Ctrl + K',  desc: 'Open search palette' },
    { keys: '?',         desc: 'Show / hide this shortcut reference' },
    { keys: 'Esc',       desc: 'Cancel active mode (connect / outline / line)' },
  ];

  let overlay = null;

  const show = () => {
    if (overlay) return;
    overlay = el('div', { class: 'shortcut-overlay' }, [
      el('div', { class: 'shortcut-modal' }, [
        el('div', { class: 'shortcut-header' }, [
          el('span', {}, 'Keyboard Shortcuts'),
          el('span', { class: 'modal-close', onclick: hide }, '×'),
        ]),
        el('div', { class: 'shortcut-list' },
          SHORTCUTS.map(s => el('div', { class: 'shortcut-row' }, [
            el('span', { class: 'shortcut-keys' }, s.keys),
            el('span', { class: 'shortcut-desc' }, s.desc),
          ]))
        ),
      ]),
    ]);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) hide(); });
    document.body.appendChild(overlay);
  };

  const hide = () => { overlay?.remove(); overlay = null; };

  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    const editing = tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable;
    if (!editing && e.key === '?') { e.preventDefault(); overlay ? hide() : show(); }
    if (e.key === 'Escape' && overlay) hide();
  });
}

bootstrap().catch(err => {
  console.error(err);
  toast('Failed to start: ' + err.message);
});