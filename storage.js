// storage.js — persistence layer.
// Two backends:
//   1) Supabase (real auth + per-user sync) when SUPABASE_CONFIG is filled in.
//   2) localStorage fallback when it isn't — keeps the app usable.
//
// Notes are now typed nodes in a hierarchy:
//   subject (largest) > topic > subtopic > note (smallest, "anything")
// `parent_id` encodes the hierarchy edge. `note_links` still exists for
// wikilink-derived links (kind: 'wikilink') and now also for explicit
// graph connections drawn by the user (kind: 'manual').
import { SUPABASE_CONFIG, APP_CONFIG } from './config.js';

const LS_KEY = 'nexuslearn.v2';
let supabase = null;
let currentUser = null;
let localMode = false;
let cache = null;

const NODE_TYPES = ['subject', 'topic', 'subtopic', 'note'];

function loadCache() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    cache = raw ? JSON.parse(raw) : null;
  } catch {
    cache = null;
  }
  if (!cache) {
    cache = {
      user_id: APP_CONFIG.localUserId,
      notes: [],
      note_links: [],
      graph_objects: [],
      materials: [],
      tests: [],
      test_attempts: [],
      flashcards: [],
      settings: defaultSettings(),
    };
    seedDemoData();
  }
  migrateCacheShape();
}

// Backfill fields on data saved before nodes had types/hierarchy, and
// before graph_objects (Title/Outline canvas annotations) existed.
function migrateCacheShape() {
  if (!cache.graph_objects) cache.graph_objects = [];
  if (!cache.settings) cache.settings = defaultSettings();
  // Backfill sidebar customization opts for settings saved before this existed.
  if (!cache.settings.sidebarOpts) {
    cache.settings.sidebarOpts = { width: 200, sort: 'name', showProgress: true, showExam: true, compact: false };
  }
  if (!cache.notes) return;
  for (const n of cache.notes) {
    if (!NODE_TYPES.includes(n.type)) n.type = 'note';
    if (n.parent_id === undefined) n.parent_id = null;
  }
}

function seedDemoData() {
  const now = () => new Date().toISOString();
  const uid = APP_CONFIG.localUserId;
  const id = () => crypto.randomUUID();

  // IDs
  const sPhysics  = id(), sMath    = id();
  const tMechanics= id(), tCalc    = id(), tThermo = id();
  const stNewton  = id(), stLimits = id();
  const nNewton1  = id(), nNewton2 = id(), nLimits1= id(), nHeat   = id();
  const linkId1   = id(), linkId2  = id();
  const titleId   = id(), outlineId= id();

  const notes = [
    // Subjects
    { id: sPhysics,   user_id: uid, type: 'subject',  parent_id: null, title: 'Physics',
      color: '#6F00FF', tags: [], subject: 'Physics',
      body: '## Physics\n\nCore natural science subject covering mechanics, thermodynamics, and more.',
      created_at: now(), updated_at: now() },
    { id: sMath,      user_id: uid, type: 'subject',  parent_id: null, title: 'Mathematics',
      color: '#38BDF8', tags: [], subject: 'Mathematics',
      body: '## Mathematics\n\nFoundations of calculus, algebra, and analysis.',
      created_at: now(), updated_at: now() },

    // Topics
    { id: tMechanics, user_id: uid, type: 'topic',    parent_id: sPhysics, title: 'Classical Mechanics',
      color: '#A78BFA', tags: ['core'], subject: 'Physics',
      body: '## Classical Mechanics\n\nStudy of motion, forces, and energy in macroscopic systems.\n\n- Deals with objects much larger than atoms\n- Governed by Newton\'s laws',
      created_at: now(), updated_at: now() },
    { id: tThermo,    user_id: uid, type: 'topic',    parent_id: sPhysics, title: 'Thermodynamics',
      color: '#FB923C', tags: ['core'], subject: 'Physics',
      body: '## Thermodynamics\n\nStudy of heat, energy, and work.\n\n- First law: energy is conserved\n- Second law: entropy always increases',
      created_at: now(), updated_at: now() },
    { id: tCalc,      user_id: uid, type: 'topic',    parent_id: sMath, title: 'Calculus',
      color: '#4ADE80', tags: ['analysis'], subject: 'Mathematics',
      body: '## Calculus\n\nBranch of mathematics studying continuous change.\n\n- Differential calculus: rates of change\n- Integral calculus: accumulation',
      created_at: now(), updated_at: now() },

    // Subtopics
    { id: stNewton,   user_id: uid, type: 'subtopic', parent_id: tMechanics, title: 'Newton\'s Laws',
      color: '#C084FC', tags: [], subject: 'Physics',
      body: '## Newton\'s Laws\n\nThree fundamental laws describing motion.\n\n- First law: an object at rest stays at rest\n- Second law: F = ma\n- Third law: every action has an equal and opposite reaction',
      created_at: now(), updated_at: now() },
    { id: stLimits,   user_id: uid, type: 'subtopic', parent_id: tCalc, title: 'Limits',
      color: '#34D399', tags: [], subject: 'Mathematics',
      body: '## Limits\n\nFoundation of calculus — what a function approaches as input nears a value.\n\n> The derivative is defined as a limit of a difference quotient\n\n- lim(x→a) f(x) = L means f(x) gets arbitrarily close to L',
      created_at: now(), updated_at: now() },

    // Notes
    { id: nNewton1,   user_id: uid, type: 'note',     parent_id: stNewton, title: 'F = ma Derivation',
      color: '#F472B6', tags: ['formula', 'key'], subject: 'Physics',
      body: '## F = ma\n\nNewton\'s second law in its most compact form.\n\n- F is net force in Newtons\n- m is mass in kilograms\n- a is acceleration in m/s²\n\nSee also [[Limits]] for the calculus connection to acceleration.',
      created_at: now(), updated_at: now() },
    { id: nNewton2,   user_id: uid, type: 'note',     parent_id: stNewton, title: 'Inertia Examples',
      color: '#F87171', tags: ['examples'], subject: 'Physics',
      body: '## Inertia Examples\n\n- A ball rolling on a frictionless surface keeps rolling\n- Passengers lurch forward when a car brakes\n- A spinning top stays upright due to angular inertia\n\nInertia is proportional to mass — heavier objects resist acceleration more.',
      created_at: now(), updated_at: now() },
    { id: nLimits1,   user_id: uid, type: 'note',     parent_id: stLimits, title: 'L\'Hôpital\'s Rule',
      color: '#22D3EE', tags: ['technique'], subject: 'Mathematics',
      body: '## L\'Hôpital\'s Rule\n\nFor indeterminate forms 0/0 or ∞/∞:\n\n```lim f(x)/g(x) = lim f\'(x)/g\'(x)```\n\n- Only applies when both f and g approach 0 or ∞\n- Can be applied repeatedly if needed',
      created_at: now(), updated_at: now() },
    { id: nHeat,      user_id: uid, type: 'note',     parent_id: tThermo, title: 'Heat Transfer Modes',
      color: '#FBBF24', tags: ['overview'], subject: 'Physics',
      body: '## Heat Transfer\n\nThree mechanisms:\n\n- **Conduction** — transfer through direct contact (metals conduct well)\n- **Convection** — transfer via fluid movement (boiling water)\n- **Radiation** — transfer via electromagnetic waves (sunlight)',
      created_at: now(), updated_at: now() },
  ];

  // Wikilink: F=ma note links to Limits
  const note_links = [
    { id: linkId1, user_id: uid, source: nNewton1, target: stLimits, kind: 'wikilink' },
    { id: linkId2, user_id: uid, source: tMechanics, target: tCalc, kind: 'manual', color: '#6F00FF' },
  ];

  // A title and outline annotation on the graph canvas
  const graph_objects = [
    { id: titleId,   user_id: uid, type: 'title',   text: 'My Study Vault',
      x: 0, y: -220, color: 'rgba(255,255,255,0.85)' },
    { id: outlineId, user_id: uid, type: 'outline',
      x1: -320, y1: -160, x2: 320, y2: 260, color: '#6F00FF' },
  ];

  cache.notes        = notes;
  cache.note_links   = note_links;
  cache.graph_objects= graph_objects;
}

function defaultSettings() {
  return {
    accent: '#6F00FF',
    accentBright: '#A966FF',
    fontSize: 14,
    fontFamily: "'Inter',sans-serif",
    graphOpts: { labels: true, nodeSize: 8, linkStrength: 5 },
    aiOpts: { autoAnalyze: true, showQuiz: true, examCountdown: true },
    addons: { pomodoro: false, spacedRep: true, examSim: false, mindMap: true },
    examDate: '',
    sidebarOpts: { width: 200, sort: 'name', showProgress: true, showExam: true, compact: false },
  };
}

function saveCache() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); } catch {}
}

export function isLocalMode() { return localMode; }

export function getCurrentUser() {
  return currentUser ? { id: currentUser.id, email: currentUser.email } : { id: APP_CONFIG.localUserId, email: 'local' };
}

export async function initStorage() {
  loadCache();
  if (SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey) {
    try {
      const mod = await import('https://esm.sh/@supabase/supabase-js@2');
      supabase = mod.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      // getSession() can hang indefinitely if the Supabase project is
      // unreachable (paused, deleted, DNS failure, offline, etc.) — it may
      // try to refresh a stored token over the network with no timeout of
      // its own. Race it against a hard timeout so app boot never freezes;
      // worst case we just fall back to local mode a few seconds late.
      const { data } = await Promise.race([
        supabase.auth.getSession(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase getSession timed out')), 4000)),
      ]);
      currentUser = data.session?.user || null;
      if (currentUser) await pullAll();
      return { mode: 'supabase', user: getCurrentUser() };
    } catch (err) {
      console.warn('Supabase init failed, falling back to local mode.', err);
      // Kill the background auto-refresh loop too, otherwise it keeps
      // retrying against the unreachable host forever and spams the
      // console even after we've already fallen back to local mode.
      try { supabase?.auth.stopAutoRefresh?.(); } catch {}
      supabase = null;
    }
  }
  localMode = true;
  return { mode: 'local', user: getCurrentUser() };
}

export function onAuthChange(cb) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    if (currentUser) await pullAll();
    cb(getCurrentUser());
  });
  return () => data.subscription.unsubscribe();
}

export async function signIn(email, password) {
  if (!supabase) return { error: 'Supabase not configured' };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  currentUser = data.user;
  await pullAll();
  return { user: getCurrentUser() };
}

export async function signUp(email, password) {
  if (!supabase) return { error: 'Supabase not configured' };
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };
  currentUser = data.user;
  await pullAll();
  return { user: getCurrentUser() };
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
  currentUser = null;
}

async function pullAll() {
  if (!supabase || !currentUser) return;
  const uid = currentUser.id;
  const [notesR, linksR, objR, matsR, testsR, attemptsR, cardsR, setR] = await Promise.all([
    supabase.from('notes').select('*').eq('user_id', uid),
    supabase.from('note_links').select('*').eq('user_id', uid),
    supabase.from('graph_objects').select('*').eq('user_id', uid),
    supabase.from('materials').select('*').eq('user_id', uid),
    supabase.from('tests').select('*').eq('user_id', uid),
    supabase.from('test_attempts').select('*').eq('user_id', uid),
    supabase.from('flashcards').select('*').eq('user_id', uid),
    supabase.from('user_settings').select('*').eq('user_id', uid).maybeSingle(),
  ]);
  cache = {
    user_id: uid,
    notes: notesR.data || [],
    note_links: linksR.data || [],
    graph_objects: objR.data || [],
    materials: matsR.data || [],
    tests: testsR.data || [],
    test_attempts: attemptsR.data || [],
    flashcards: cardsR.data || [],
    settings: setR.data || defaultSettings(),
  };
  migrateCacheShape();
  saveCache();
}

// ── Read accessors (work in both modes) ─────────────────────
export function getNotes() { return cache.notes.slice().sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')); }
export function getNote(id) { return cache.notes.find(n => n.id === id) || null; }
export function getNoteByTitle(title) {
  const t = title.trim().toLowerCase();
  return cache.notes.find(n => n.title.toLowerCase() === t) || null;
}
export function getNoteLinks() { return cache.note_links.slice(); }
export function getMaterials() { return cache.materials.slice(); }
export function getTests() { return cache.tests.slice(); }
export function getAttempts() { return cache.test_attempts.slice(); }
export function getFlashcards() { return cache.flashcards.slice(); }
export function getSettings() { return cache.settings; }

// ── Hierarchy helpers (Subject > Topic > Subtopic > Note) ───
export function getChildren(id) {
  return cache.notes.filter(n => n.parent_id === id).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}
export function getDescendants(id) {
  const out = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const k of getChildren(cur)) { out.push(k); stack.push(k.id); }
  }
  return out;
}
export function getAncestors(id) {
  const out = [];
  let cur = getNote(id);
  while (cur && cur.parent_id) {
    const p = getNote(cur.parent_id);
    if (!p) break;
    out.push(p);
    cur = p;
  }
  return out;
}
export function getSubjectNodes() {
  return cache.notes.filter(n => (n.type || 'note') === 'subject').sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}
// Walks up the hierarchy to find the owning Subject's title, falling back
// to the legacy free-text `subject` field for un-parented notes.
export function getEffectiveSubject(note) {
  if (!note) return 'General';
  if ((note.type || 'note') === 'subject') return note.title;
  const anc = getAncestors(note.id).find(a => (a.type || 'note') === 'subject');
  return anc ? anc.title : (note.subject || 'General');
}
export function validParentTypesFor(type) {
  if (type === 'topic') return ['subject'];
  if (type === 'subtopic') return ['topic'];
  if (type === 'note') return ['subject', 'topic', 'subtopic'];
  return [];
}

// One-time (idempotent) upgrade: any legacy flat note (type 'note', no
// parent_id) gets bucketed under a real Subject node matching its old
// free-text `subject` field, creating that Subject node if needed.
export async function migrateNotesToHierarchy() {
  const legacy = cache.notes.filter(n => (n.type || 'note') === 'note' && !n.parent_id);
  if (!legacy.length) return;
  const bySubject = {};
  for (const n of legacy) {
    const s = n.subject || 'General';
    (bySubject[s] = bySubject[s] || []).push(n);
  }
  for (const [subjName, group] of Object.entries(bySubject)) {
    let subjectNode = cache.notes.find(n => (n.type || 'note') === 'subject' && n.title.toLowerCase() === subjName.toLowerCase());
    if (!subjectNode) {
      subjectNode = await createNote({ type: 'subject', title: subjName, subject: subjName, parent_id: null, body: '' });
    }
    for (const n of group) {
      n.parent_id = subjectNode.id;
      n.subject = subjectNode.title;
    }
  }
  saveCache();
  for (const n of legacy) await maybeUpsert('notes', n);
}

// ── Notes CRUD ──────────────────────────────────────────────
export async function createNote(partial) {
  const now = new Date().toISOString();
  const note = {
    id: crypto.randomUUID(),
    user_id: getCurrentUser().id,
    type: NODE_TYPES.includes(partial.type) ? partial.type : 'note',
    parent_id: partial.parent_id || null,
    title: partial.title || 'Untitled',
    color: partial.color || pickColor(),
    tags: partial.tags || [],
    subject: partial.subject || 'General',
    body: partial.body || '',
    created_at: now,
    updated_at: now,
  };
  cache.notes.push(note);
  saveCache();
  await maybeUpsert('notes', note);
  await rebuildLinksFor(note);
  return note;
}

export async function updateNote(id, patch) {
  const note = getNote(id);
  if (!note) return null;
  const wasSubject = (note.type || 'note') === 'subject';
  const oldTitle = note.title;
  Object.assign(note, patch, { updated_at: new Date().toISOString() });
  saveCache();
  await maybeUpsert('notes', note);
  if ('body' in patch || 'title' in patch) await rebuildLinksFor(note);
  // Renaming a Subject cascades its name into every descendant's `subject`
  // field, since Materials/Tests group by that free-text field.
  if (wasSubject && 'title' in patch && patch.title !== oldTitle) {
    const desc = getDescendants(id);
    for (const d of desc) { d.subject = note.title; await maybeUpsert('notes', d); }
    if (desc.length) saveCache();
  }
  return note;
}

export async function deleteNote(id) {
  cache.notes = cache.notes.filter(n => n.id !== id);
  const orphaned = [];
  for (const n of cache.notes) {
    if (n.parent_id === id) { n.parent_id = null; orphaned.push(n); }
  }
  cache.note_links = cache.note_links.filter(l => l.source !== id && l.target !== id);
  saveCache();
  await maybeDel('notes', id);
  for (const n of orphaned) await maybeUpsert('notes', n);
  await maybeDel('note_links', null, { source: id });
  await maybeDel('note_links', null, { target: id });
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

// Only rebuilds links of kind 'wikilink' sourced from this note — manual
// graph connections the user drew are left untouched.
export async function rebuildLinksFor(note) {
  cache.note_links = cache.note_links.filter(l => !(l.source === note.id && l.kind !== 'manual'));
  const targets = new Set();
  let m;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(note.body || '')) !== null) {
    const target = getNoteByTitle(m[1]);
    if (target && target.id !== note.id) targets.add(target.id);
  }
  for (const tid of targets) {
    const link = { id: crypto.randomUUID(), user_id: note.user_id, source: note.id, target: tid, kind: 'wikilink' };
    cache.note_links.push(link);
    await maybeUpsert('note_links', link);
  }
  saveCache();
}

export async function rebuildAllLinks() {
  cache.note_links = cache.note_links.filter(l => l.kind === 'manual');
  if (!supabase) { saveCache(); return; }
  await supabase.from('note_links').delete().eq('user_id', currentUser.id).neq('kind', 'manual');
  for (const n of cache.notes) await rebuildLinksFor(n);
}

// Explicit user-drawn graph connection (not derived from [[wikilinks]]).
export async function createManualLink(sourceId, targetId, color = null) {
  if (!sourceId || !targetId || sourceId === targetId) return null;
  const exists = cache.note_links.find(l =>
    (l.source === sourceId && l.target === targetId) || (l.source === targetId && l.target === sourceId));
  if (exists) return exists;
  const link = { id: crypto.randomUUID(), user_id: getCurrentUser().id, source: sourceId, target: targetId, kind: 'manual', color };
  cache.note_links.push(link);
  saveCache();
  await maybeUpsert('note_links', link);
  return link;
}

export async function updateLink(linkId, patch) {
  const l = cache.note_links.find(x => x.id === linkId);
  if (!l) return null;
  Object.assign(l, patch);
  saveCache();
  await maybeUpsert('note_links', l);
  return l;
}

export async function deleteLink(linkId) {
  cache.note_links = cache.note_links.filter(l => l.id !== linkId);
  saveCache();
  await maybeDel('note_links', linkId);
}

// ── Graph objects (Title / Outline canvas annotations) ───────
// These live purely on the Graph canvas — they're not notes, have no
// body/hierarchy, and don't feed AI grounding. Just visual structure.
export function getGraphObjects() { return cache.graph_objects.slice(); }

export async function createGraphObject(partial) {
  const obj = {
    id: crypto.randomUUID(),
    user_id: getCurrentUser().id,
    type: partial.type, // 'title' | 'outline'
    ...partial,
  };
  cache.graph_objects.push(obj);
  saveCache();
  await maybeUpsert('graph_objects', obj);
  return obj;
}

export async function updateGraphObject(id, patch) {
  const o = cache.graph_objects.find(x => x.id === id);
  if (!o) return null;
  Object.assign(o, patch);
  saveCache();
  await maybeUpsert('graph_objects', o);
  return o;
}

export async function deleteGraphObject(id) {
  cache.graph_objects = cache.graph_objects.filter(o => o.id !== id);
  saveCache();
  await maybeDel('graph_objects', id);
}

// ── Materials ───────────────────────────────────────────────
export async function createMaterial(partial) {
  const m = {
    id: crypto.randomUUID(),
    user_id: getCurrentUser().id,
    subject: partial.subject || 'General',
    title: partial.title || 'Untitled material',
    kind: partial.kind || 'article',
    content: partial.content || '',
    source: partial.source || '',
    created_at: new Date().toISOString(),
  };
  cache.materials.push(m);
  saveCache();
  await maybeUpsert('materials', m);
  return m;
}

export async function updateMaterial(id, patch) {
  const m = cache.materials.find(x => x.id === id);
  if (!m) return null;
  Object.assign(m, patch);
  saveCache();
  await maybeUpsert('materials', m);
  return m;
}

export async function deleteMaterial(id) {
  cache.materials = cache.materials.filter(m => m.id !== id);
  saveCache();
  await maybeDel('materials', id);
}

// ── Tests ───────────────────────────────────────────────────
export async function createTest(partial) {
  const t = {
    id: crypto.randomUUID(),
    user_id: getCurrentUser().id,
    subject: partial.subject || 'General',
    title: partial.title || 'Test',
    items: partial.items || [],
    created_at: new Date().toISOString(),
  };
  cache.tests.push(t);
  saveCache();
  await maybeUpsert('tests', t);
  return t;
}

export async function deleteTest(id) {
  cache.tests = cache.tests.filter(t => t.id !== id);
  cache.test_attempts = cache.test_attempts.filter(a => a.test_id !== id);
  saveCache();
  await maybeDel('tests', id);
}

export async function recordAttempt(testId, answers, score) {
  const a = {
    id: crypto.randomUUID(),
    test_id: testId,
    user_id: getCurrentUser().id,
    answers,
    score,
    taken_at: new Date().toISOString(),
  };
  cache.test_attempts.push(a);
  saveCache();
  await maybeUpsert('test_attempts', a);
  return a;
}

// ── Flashcards (SM-2 lite) ──────────────────────────────────
export async function createFlashcard(partial) {
  const c = {
    id: crypto.randomUUID(),
    user_id: getCurrentUser().id,
    front: partial.front || '',
    back: partial.back || '',
    subject: partial.subject || 'General',
    next_review: new Date().toISOString(),
    interval_days: 0,
    ease: 2.5,
    created_at: new Date().toISOString(),
  };
  cache.flashcards.push(c);
  saveCache();
  await maybeUpsert('flashcards', c);
  return c;
}

export async function reviewFlashcard(id, grade) {
  const c = cache.flashcards.find(x => x.id === id);
  if (!c) return;
  if (grade < 3) { c.interval_days = 0; c.ease = Math.max(1.3, c.ease - 0.2); }
  else {
    c.interval_days = c.interval_days === 0 ? 1 : c.interval_days === 1 ? 3 : Math.round(c.interval_days * c.ease);
    c.ease = Math.max(1.3, c.ease + (grade - 3) * 0.1);
  }
  const next = new Date();
  next.setDate(next.getDate() + c.interval_days);
  c.next_review = next.toISOString();
  saveCache();
  await maybeUpsert('flashcards', c);
}

export async function deleteFlashcard(id) {
  cache.flashcards = cache.flashcards.filter(c => c.id !== id);
  saveCache();
  await maybeDel('flashcards', id);
}

export function getDueFlashcards() {
  const now = Date.now();
  return cache.flashcards.filter(c => new Date(c.next_review).getTime() <= now);
}

// ── Settings ────────────────────────────────────────────────
export async function updateSettings(patch) {
  cache.settings = { ...cache.settings, ...patch };
  saveCache();
  if (supabase && currentUser) {
    const row = { user_id: currentUser.id, ...cache.settings };
    await supabase.from('user_settings').upsert(row);
  }
}

// ── Bulk export / import ────────────────────────────────────
// Full-vault backup: every collection, as-is. Used for a complete export;
// callers that only want the graph (notes/links/graph_objects) can just
// pick the fields they need off the result.
export function exportData() {
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    notes: cache.notes,
    note_links: cache.note_links,
    graph_objects: cache.graph_objects,
    materials: cache.materials,
    tests: cache.tests,
    flashcards: cache.flashcards,
  };
}

// Replaces whichever collections are present (as arrays) in `payload`,
// leaving any collection payload doesn't mention untouched — so an import
// of just { notes, note_links, graph_objects } (a "graph" export) leaves
// materials/tests/flashcards exactly as they were. Persists locally, and
// best-effort mirrors the change to Supabase when signed in.
export async function importData(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid import payload');
  const uid = getCurrentUser().id;
  const stamp = (rows) => (Array.isArray(rows) ? rows.map(r => ({ ...r, user_id: r.user_id || uid })) : null);

  const next = {
    notes:         stamp(payload.notes),
    note_links:    stamp(payload.note_links),
    graph_objects: stamp(payload.graph_objects),
    materials:     stamp(payload.materials),
    tests:         stamp(payload.tests),
    flashcards:    stamp(payload.flashcards),
  };

  for (const [key, rows] of Object.entries(next)) {
    if (rows) cache[key] = rows;
  }

  migrateCacheShape();
  saveCache();

  if (supabase && currentUser) {
    const pushReplace = async (table, rows) => {
      if (!rows) return;
      try {
        await supabase.from(table).delete().eq('user_id', uid);
        if (rows.length) await supabase.from(table).insert(rows);
      } catch (err) { console.warn(`import replace ${table} failed`, err); }
    };
    await Promise.all([
      pushReplace('notes', next.notes),
      pushReplace('note_links', next.note_links),
      pushReplace('graph_objects', next.graph_objects),
      pushReplace('materials', next.materials),
      pushReplace('tests', next.tests),
      pushReplace('flashcards', next.flashcards),
    ]);
  }

  return {
    notes: next.notes?.length || 0,
    note_links: next.note_links?.length || 0,
    graph_objects: next.graph_objects?.length || 0,
  };
}

// ── Supabase push helpers ───────────────────────────────────
async function maybeUpsert(table, row) {
  if (!supabase || !currentUser) return;
  try { await supabase.from(table).upsert(row); }
  catch (err) { console.warn(`upsert ${table} failed`, err); }
}

async function maybeDel(table, id, eq) {
  if (!supabase || !currentUser) return;
  try {
    if (id) await supabase.from(table).delete().eq('id', id);
    else if (eq) for (const [k, v] of Object.entries(eq)) await supabase.from(table).delete().eq(k, v);
  } catch (err) { console.warn(`delete ${table} failed`, err); }
}

const PALETTE = ['#6F00FF', '#4ADE80', '#FBBF24', '#38BDF8', '#F472B6', '#FB923C', '#A78BFA', '#F87171'];
function pickColor() { return PALETTE[Math.floor(Math.random() * PALETTE.length)]; }