// ai-suggest.js — AI auto-node suggestions with approval toasts.
//
// After a user creates a topic/subtopic/note, Claude suggests 2 more
// SIBLING nodes at the same level under the same parent.
// e.g. Math > Addition created → AI suggests Math > Subtraction, Math > Multiplication

import { AI_CONFIG } from './config.js';
import { createNote, getNote, deleteNote, getChildren, getEffectiveSubject } from './storage.js';
import { renderList } from './notes.js';

// ── Host element for all suggestion cards ─────────────────────
let host = null;
function getHost() {
  if (!host || !document.body.contains(host)) {
    host = document.createElement('div');
    host.id = 'ai-suggest-host';
    host.style.cssText = [
      'position:fixed',
      'bottom:80px',
      'right:296px',
      'z-index:750',
      'display:flex',
      'flex-direction:column-reverse',
      'gap:8px',
      'pointer-events:none',
      'max-width:300px',
    ].join(';');
    document.body.appendChild(host);
  }
  return host;
}

// ── Main API ──────────────────────────────────────────────────
export async function triggerAutoSuggest(node, positions = null, graphPositionCallback = null) {
  const type = node.type || 'note';
  if (type === 'subject') return; // no suggestions for subjects

  const suggestions = await fetchSuggestions(node);
  if (!suggestions.length) return;

  for (let i = 0; i < suggestions.length; i++) {
    await delay(i === 0 ? 400 : 800);
    await spawnSuggestionCard(suggestions[i], node, positions, graphPositionCallback);
  }
}

// ── Claude API call ───────────────────────────────────────────
async function fetchSuggestions(node) {
  const type    = node.type || 'note';
  const subject = getEffectiveSubject(node);
  const parent  = node.parent_id ? getNote(node.parent_id) : null;

  // All existing siblings so AI doesn't repeat them
  const existingSiblings = parent
    ? getChildren(parent.id).filter(c => c.id !== node.id).map(c => c.title)
    : [];
  const siblingList = existingSiblings.length
    ? `Already exists under "${parent.title}": ${existingSiblings.join(', ')}.`
    : '';

  const parentDesc = parent
    ? `"${parent.title}" (${parent.type}) inside subject "${subject}"`
    : `subject "${subject}"`;

  const prompt = `A student is studying "${subject}". They just added a ${type} called "${node.title}" under ${parentDesc}.

Suggest 2 more ${type}s that belong alongside "${node.title}" under the same parent "${parent ? parent.title : subject}".

These must be peer/sibling topics at the same level. For example:
- Subject "Math", topic "Addition" → suggest "Subtraction", "Multiplication"
- Subject "Physics", topic "Mechanics" → suggest "Thermodynamics", "Optics"
${siblingList}

Rules:
- Same level and type as "${node.title}" (both are ${type}s under the same parent)
- Short titles only (1-4 words)
- No repeats from the existing list above
- Return ONLY a JSON array of 2 strings. No prose, no markdown fences.
Example: ["Subtraction","Multiplication"]`;

  if (!AI_CONFIG.apiKey) return heuristicSuggestions(node, subject);

  try {
    const res = await fetch(
      `${AI_CONFIG.endpoint}/${AI_CONFIG.model}:generateContent?key=${AI_CONFIG.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 80 },
        }),
      }
    );
    if (!res.ok) return heuristicSuggestions(node, subject);
    const data  = await res.json();
    const raw   = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const match = raw.match(/\[[\s\S]*?\]/);
    if (!match) return heuristicSuggestions(node, subject);
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return heuristicSuggestions(node, subject);
    const existingLower = existingSiblings.map(s => s.toLowerCase());
    return parsed
      .filter(s => typeof s === 'string' && s.trim())
      .filter(s => !existingLower.includes(s.trim().toLowerCase()))
      .slice(0, 2);
  } catch {
    return heuristicSuggestions(node, subject);
  }
}

function heuristicSuggestions(node, subject) {
  const s = (subject || '').toLowerCase();
  const type = node.type || 'note';

  const SUBJECT_SIBLINGS = {
    math:        ['Addition','Subtraction','Multiplication','Division','Algebra','Geometry','Calculus','Statistics'],
    mathematics: ['Addition','Subtraction','Multiplication','Division','Algebra','Geometry','Calculus','Statistics'],
    physics:     ['Mechanics','Thermodynamics','Electromagnetism','Optics','Quantum Physics','Waves'],
    chemistry:   ['Organic Chemistry','Inorganic Chemistry','Physical Chemistry','Acids & Bases','Reactions'],
    biology:     ['Cell Biology','Genetics','Ecology','Evolution','Anatomy','Microbiology'],
    history:     ['Ancient History','Medieval History','Modern History','World Wars','Renaissance'],
    english:     ['Grammar','Literature','Writing','Poetry','Reading Comprehension','Vocabulary'],
    geography:   ['Physical Geography','Human Geography','Climate','Maps','Ecosystems'],
    economics:   ['Microeconomics','Macroeconomics','Supply & Demand','Markets','Fiscal Policy'],
    computer:    ['Algorithms','Data Structures','Networking','Databases','Operating Systems'],
  };

  const key = Object.keys(SUBJECT_SIBLINGS).find(k => s.includes(k));
  if (key) {
    const pool = SUBJECT_SIBLINGS[key].filter(t => t.toLowerCase() !== (node.title || '').toLowerCase());
    return pool.slice(0, 2);
  }

  if (type === 'topic')    return [`${subject} Basics`, `${subject} Applications`];
  if (type === 'subtopic') return [`${node.title} Examples`, `${node.title} Practice`];
  return [`${node.title} Summary`, `${node.title} Key Points`];
}

// ── Card spawning ─────────────────────────────────────────────
const COUNTDOWN_MS = 12000;

async function spawnSuggestionCard(title, sibling, positions, graphPositionCallback) {
  // Create node as a SIBLING — same parent_id and type as the node the user just made
  const newNode = await createNote({
    type:      sibling.type || 'note',
    parent_id: sibling.parent_id,          // same parent = true sibling
    title:     title.trim(),
    subject:   getEffectiveSubject(sibling),
    body:      '',
  });

  // Place it near its sibling on the graph
  if (positions && sibling.id && positions[sibling.id]) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = 90 + Math.random() * 50;
    positions[newNode.id] = {
      x: positions[sibling.id].x + Math.cos(angle) * dist,
      y: positions[sibling.id].y + Math.sin(angle) * dist,
    };
    graphPositionCallback?.();
  }

  renderList();

  const card = buildCard(title, newNode, sibling);
  getHost().appendChild(card);
  runCountdown(card, newNode, COUNTDOWN_MS);
}

function buildCard(title, newNode, sibling) {
  const type      = sibling.type || 'note';
  const typeLabel = { topic: 'TOPIC', subtopic: 'SUBTOPIC', note: 'NOTE' }[type] || type.toUpperCase();
  const subject   = getEffectiveSubject(sibling);
  const parent    = sibling.parent_id ? getNote(sibling.parent_id) : null;

  const card = document.createElement('div');
  card.className = 'ai-suggest-card';
  card.style.cssText = [
    'pointer-events:all',
    'background:var(--panel)',
    'border:1px solid var(--violet)',
    'border-radius:10px',
    'padding:12px 14px 10px',
    'width:284px',
    'box-shadow:0 8px 32px rgba(111,0,255,0.22),0 0 0 1px rgba(111,0,255,0.12)',
    'animation:ai-suggest-in 0.28s cubic-bezier(.34,1.56,.64,1) both',
    'position:relative',
    'overflow:hidden',
  ].join(';');

  if (!document.getElementById('ai-suggest-style')) {
    const s = document.createElement('style');
    s.id = 'ai-suggest-style';
    s.textContent = `
      @keyframes ai-suggest-in {
        from { opacity:0; transform:translateX(24px) scale(0.94); }
        to   { opacity:1; transform:translateX(0) scale(1); }
      }
      @keyframes ai-suggest-out {
        to { opacity:0; transform:translateX(40px) scale(0.9); }
      }
      .ai-suggest-card.removing {
        animation: ai-suggest-out 0.22s ease forwards;
      }
    `;
    document.head.appendChild(s);
  }

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:7px;margin-bottom:6px;';

  const orb = document.createElement('div');
  orb.style.cssText = 'width:18px;height:18px;border-radius:50%;background:var(--violet);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:9px;color:white;font-weight:700;';
  orb.textContent = '✦';

  const label = document.createElement('span');
  label.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:0.08em;color:var(--violet-bright);text-transform:uppercase;';
  label.textContent = 'AI suggested';

  const typePill = document.createElement('span');
  typePill.style.cssText = 'margin-left:auto;font-size:9px;font-weight:700;letter-spacing:0.06em;color:var(--violet-bright);background:var(--violet-glow);border:1px solid var(--border);border-radius:3px;padding:1px 5px;';
  typePill.textContent = typeLabel;

  header.append(orb, label, typePill);

  // Title
  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-size:14px;font-weight:600;color:var(--white);margin-bottom:4px;line-height:1.3;';
  titleEl.textContent = `"${title}"`;

  // Context line — shows exactly where this node will live
  const sub = document.createElement('div');
  sub.style.cssText = 'font-size:11px;color:var(--text-dim);margin-bottom:10px;';
  const where = parent ? `${subject} › ${parent.title}` : subject;
  sub.textContent = `${typeLabel} under ${where}`;

  // Buttons
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:6px;';

  const approveBtn = document.createElement('button');
  approveBtn.textContent = '✓ Keep';
  approveBtn.style.cssText = 'flex:1;padding:5px 0;border-radius:6px;border:1px solid var(--violet);background:var(--violet);color:white;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:background 0.12s;';
  approveBtn.onmouseenter = () => approveBtn.style.background = 'var(--violet-bright)';
  approveBtn.onmouseleave = () => approveBtn.style.background = 'var(--violet)';

  const declineBtn = document.createElement('button');
  declineBtn.textContent = '✕ Remove';
  declineBtn.style.cssText = 'flex:1;padding:5px 0;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text-muted);font-size:11.5px;font-weight:500;cursor:pointer;font-family:inherit;transition:all 0.12s;';
  declineBtn.onmouseenter = () => { declineBtn.style.borderColor='#F87171'; declineBtn.style.color='#F87171'; };
  declineBtn.onmouseleave = () => { declineBtn.style.borderColor='var(--border)'; declineBtn.style.color='var(--text-muted)'; };

  btnRow.append(approveBtn, declineBtn);

  // Countdown bar
  const barWrap = document.createElement('div');
  barWrap.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:3px;background:rgba(111,0,255,0.15);';
  const bar = document.createElement('div');
  bar.style.cssText = `height:100%;width:100%;background:linear-gradient(90deg,var(--violet),var(--violet-bright));transition:width ${COUNTDOWN_MS}ms linear;`;
  barWrap.appendChild(bar);

  card.append(header, titleEl, sub, btnRow, barWrap);

  card._bar        = bar;
  card._approveBtn = approveBtn;
  card._declineBtn = declineBtn;
  card._newNodeId  = newNode.id;
  card._approved   = false;
  card._declined   = false;

  return card;
}

function runCountdown(card, newNode, ms) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { card._bar.style.width = '0%'; });
  });

  const timer = setTimeout(() => {
    if (!card._declined) dismissCard(card);
  }, ms);

  card._approveBtn.addEventListener('click', () => {
    if (card._declined) return;
    card._approved = true;
    clearTimeout(timer);
    dismissCard(card);
    showMicroToast(`✓ Kept "${newNode.title}"`);
  });

  card._declineBtn.addEventListener('click', async () => {
    if (card._approved) return;
    card._declined = true;
    clearTimeout(timer);
    dismissCard(card);
    await deleteNote(newNode.id);
    renderList();
    showMicroToast(`Removed "${newNode.title}"`);
  });
}

function dismissCard(card) {
  card.classList.add('removing');
  setTimeout(() => card.remove(), 240);
}

function showMicroToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:800;background:var(--card);border:1px solid var(--border);color:var(--text);padding:6px 12px;border-radius:6px;font-size:12px;opacity:0;transform:translateY(8px);transition:all 0.2s;';
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity='1'; t.style.transform='translateY(0)'; });
  setTimeout(() => { t.style.opacity='0'; setTimeout(() => t.remove(), 300); }, 2200);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }