// ai.js — AI assistant using Cohere's Chat API.
// Falls back to a heuristic path when no API key is configured.
// Both paths are grounded in the user's note hierarchy (Subject > Topic > Subtopic > Note).
import { AI_CONFIG } from './config.js';
import {
  getNotes, getNote, getNoteLinks, getSettings,
  getChildren, getDescendants, getSubjectNodes, getEffectiveSubject,
} from './storage.js';
import { daysUntil } from './ui.js';
import { getActiveNote, getOpenTabs } from './notes.js';

// Cohere endpoint for chat
const COHERE_ENDPOINT = 'https://api.cohere.com/v2/chat';

// Default model — change to 'command-r' or 'command-r-plus' if preferred
const COHERE_MODEL = AI_CONFIG.model || 'command-r-plus';

const SYSTEM_PROMPT = `You are Nexus AI, a study assistant inside a personal knowledge app called NexusLearn.
Be concise, practical, and grounded in the user's notes.
The user's notes are organized as a hierarchy: Subject > Topic > Subtopic > Note.
When the user asks about a topic, prefer referencing their own notes if relevant — including small, minor details, not just headline facts.
Prefer short paragraphs and bullets. Don't repeat the user's question.`;

export async function aiChat(messages, opts = {}) {
  if (!AI_CONFIG.apiKey) return heuristicReply(messages);

  const grounded = groundingBlock();
  const systemContent = SYSTEM_PROMPT + (grounded ? '\n\n' + grounded : '');

  // Cohere v2 uses { role, content } just like OpenAI, but the system
  // message must be role:"system" as the first entry in `messages`.
  const cohereMessages = [
    { role: 'system', content: systemContent },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  try {
    const res = await fetch(COHERE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model: COHERE_MODEL,
        messages: cohereMessages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 600,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { role: 'assistant', content: `AI error: ${res.status} ${errText.slice(0, 120)}`, error: true };
    }

    const data = await res.json();
    // Cohere v2 response shape: data.message.content[0].text
    const text = data?.message?.content?.[0]?.text || '(no response)';
    return { role: 'assistant', content: text };
  } catch (err) {
    return { role: 'assistant', content: `Network error talking to AI: ${err.message}`, error: true };
  }
}

// ── Knowledge-tree grounding ──────────────────────────────────
function buildKnowledgeTree(maxBodyChars = 200) {
  const subjects = getSubjectNodes();
  if (!subjects.length) return '';
  const lines = [];
  const renderNode = (node, depth) => {
    const indent = '  '.repeat(depth);
    const preview = (node.body || '').trim().replace(/\n+/g, ' ').slice(0, maxBodyChars);
    lines.push(`${indent}- [${node.type}] ${node.title}${preview ? ': ' + preview : ''}`);
    for (const child of getChildren(node.id)) renderNode(child, depth + 1);
  };
  for (const s of subjects) renderNode(s, 0);
  return `User's knowledge tree (Subject > Topic > Subtopic > Note):\n${lines.join('\n')}`;
}

function groundingBlock() {
  const notes = getNotes();
  if (!notes.length) return '';
  const tree = buildKnowledgeTree();
  const active = getActiveNote();
  const activeBlock = active
    ? `\nActive note "${active.title}" [${active.type || 'note'}]:\n"""${(active.body || '').slice(0, 1200)}"""`
    : '';
  return `${tree || `User's vault has ${notes.length} notes.`}${activeBlock}`;
}

// ── Fact extraction ───────────────────────────────────────────
export function extractFacts(body) {
  if (!body) return [];
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  const facts = [];
  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line)) continue;
    if (/^[-*]\s+/.test(line)) { facts.push(line.replace(/^[-*]\s+/, '').replace(/\*\*/g, '')); continue; }
    if (/^>\s+/.test(line)) { facts.push(line.replace(/^>\s+/, '')); continue; }
    if (line.length >= 12 && line.length <= 220) facts.push(line.replace(/\*\*/g, ''));
  }
  return [...new Set(facts)];
}

export function gatherFactsForTopic(topicTitle) {
  if (!topicTitle) return [];
  const all = getNotes();
  const root = all.find(n => n.title.toLowerCase() === topicTitle.trim().toLowerCase());
  let nodes;
  if (root) nodes = [root, ...getDescendants(root.id)];
  else nodes = all.filter(n => getEffectiveSubject(n).toLowerCase() === topicTitle.trim().toLowerCase());
  const facts = [];
  for (const n of nodes) {
    for (const f of extractFacts(n.body)) facts.push({ fact: f, source: n.title, type: n.type || 'note' });
  }
  return facts;
}

function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }

// ── Heuristic (no API key) reply ─────────────────────────────
function heuristicReply(messages) {
  const last = (messages[messages.length - 1]?.content || '').toLowerCase();
  const notes = getNotes();
  const active = getActiveNote();
  const links = getNoteLinks();
  const top = notes[0];

  if (last.includes('quiz') || last.includes('test')) {
    const topic = active?.title || top?.title || 'your notes';
    const facts = gatherFactsForTopic(topic);
    return { role: 'assistant', content: `Quick quiz from "${topic}":\n1) Define the core idea in your own words.\n2) What links to it? (${links.length} links in your vault)\n3) Apply it to one new example.\n\n${facts.length ? `I found ${facts.length} fact(s) in your notes I can build real questions from — try "Generate quiz" in Materials/Tests.` : 'Add bullet points to your notes so I have facts to quiz you on.'}` };
  }
  if (last.includes('summar')) {
    const node = active || top;
    if (!node) return { role: 'assistant', content: 'No note selected.' };
    const facts = extractFacts(node.body).slice(0, 4);
    const body = facts.length ? facts.map(f => `• ${f}`).join('\n') : (node.body || '').slice(0, 200);
    return { role: 'assistant', content: `Summary of "${node.title}" [${node.type || 'note'}]:\n${body}` };
  }
  if (last.includes('flashcard')) {
    const node = active || top;
    const facts = node ? extractFacts(node.body) : [];
    if (facts.length) {
      return { role: 'assistant', content: `Flashcard idea from "${node.title}":\nFront: "${facts[0].split(/[:.]/)[0].slice(0, 60)}"\nBack: "${facts[0]}"\n\nI'll add it when you click + in the Flashcards panel.` };
    }
    return { role: 'assistant', content: `Add some bullet points to "${node?.title || 'a note'}" and I can turn them straight into flashcards.` };
  }
  if (last.includes('connect') || last.includes('graph')) {
    if (!active) return { role: 'assistant', content: 'Open a note to see its connections.' };
    const kids = getChildren(active.id);
    const ancestors = getNote(active.parent_id);
    const conns = links.filter(l => l.source === active.id || l.target === active.id);
    return { role: 'assistant', content: `"${active.title}" [${active.type || 'note'}]${ancestors ? ` lives under "${ancestors.title}"` : ''} has ${kids.length} child node${kids.length === 1 ? '' : 's'} and ${conns.length} link${conns.length === 1 ? '' : 's'}. Open Graph view to see it — right-click a node there to connect or create more.` };
  }

  const mentioned = notes.find(n => n.title && last.includes(n.title.toLowerCase()));
  if (mentioned) {
    const facts = extractFacts(mentioned.body).slice(0, 4);
    return { role: 'assistant', content: `From your "${mentioned.title}" [${mentioned.type || 'note'}] note:\n${facts.length ? facts.map(f => '• ' + f).join('\n') : (mentioned.body || '(empty)').slice(0, 200)}` };
  }

  const counts = { subject: 0, topic: 0, subtopic: 0, note: 0 };
  for (const n of notes) counts[n.type || 'note'] = (counts[n.type || 'note'] || 0) + 1;
  const subjectNames = getSubjectNodes().map(s => s.title).join(', ');
  const examDays = daysUntil(getSettings().examDate);
  return { role: 'assistant', content: `Vault: ${counts.subject} subject${counts.subject === 1 ? '' : 's'}${subjectNames ? ` (${subjectNames})` : ''}, ${counts.topic} topic${counts.topic === 1 ? '' : 's'}, ${counts.subtopic} subtopic${counts.subtopic === 1 ? '' : 's'}, ${counts.note} note${counts.note === 1 ? '' : 's'}. ${examDays != null ? `Exam in ${examDays} days. ` : ''}I can summarize, quiz, or flashcard any of them — try "quiz me on <topic>" or just mention a note's title. (Set AI_CONFIG.apiKey for real LLM responses.)` };
}

// ── Quiz generation ───────────────────────────────────────────
export async function aiGenerateQuiz(topic, noteIds = []) {
  const facts = gatherFactsForTopic(topic);
  const factsBlock = facts.length
    ? `\n\nRelevant facts from the user's notes (ground questions in these, including minor details):\n${facts.map(f => `- ${f.fact} (from "${f.source}")`).join('\n')}`
    : '';
  const prompt = `Generate a 5-question multiple choice quiz on "${topic}". Return STRICT JSON of the form {"items":[{"q":"...","opts":["A","B","C","D"],"answer":0,"explain":"..."}]}. No prose.${factsBlock}`;
  const r = await aiChat([{ role: 'user', content: prompt }], { temperature: 0.3 });
  try {
    const match = r.content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]).items;
  } catch {}
  return fallbackQuiz(topic, facts);
}

function fallbackQuiz(topic, facts = null) {
  const gathered = facts || gatherFactsForTopic(topic);
  if (gathered.length >= 4) return buildFactQuiz(topic, gathered);
  return [
    { q: `Define "${topic}" in one sentence.`, opts: ['—', '—', '—', '—'], answer: 0, explain: 'Short answer; compare to your note.' },
    { q: `Which concept is most related to "${topic}"?`, opts: ['Limits', 'Energy', 'Reactions', 'None'], answer: 0, explain: 'Open a related note to confirm.' },
    { q: `Give one example of "${topic}".`, opts: ['—', '—', '—', '—'], answer: 0, explain: 'Open-ended.' },
    { q: `What's a common mistake with "${topic}"?`, opts: ['Skipping foundations', 'Using too many examples', 'Memorizing blindly', 'All of the above'], answer: 0, explain: 'Foundations matter.' },
    { q: `Apply "${topic}" to a new problem.`, opts: ['—', '—', '—', '—'], answer: 0, explain: 'Open-ended.' },
  ];
}

function buildFactQuiz(topic, facts, n = 5) {
  const pool = shuffle(facts);
  const picked = pool.slice(0, Math.min(n, pool.length));
  return picked.map(f => {
    const distractorPool = [...new Set(pool.filter(x => x.fact !== f.fact).map(x => x.fact))];
    const distractors = shuffle(distractorPool).slice(0, 3);
    while (distractors.length < 3) distractors.push('None of the above');
    const opts = shuffle([f.fact, ...distractors]);
    return {
      q: `According to your "${f.source}" note, which is correct about ${topic}?`,
      opts,
      answer: opts.indexOf(f.fact),
      explain: `Pulled from your "${f.source}" note.`,
    };
  });
}

export async function aiSummarize(text) {
  if (!text) return '(empty)';
  const r = await aiChat([{ role: 'user', content: `Summarize this note in 3 bullets:\n\n${text.slice(0, 4000)}` }], { maxTokens: 300 });
  return r.content;
}

export async function aiFlashcards(text, n = 5) {
  const prompt = `Generate ${n} flashcards from this note. Return STRICT JSON: {"cards":[{"front":"...","back":"..."}]}.\n\n${text.slice(0, 4000)}`;
  const r = await aiChat([{ role: 'user', content: prompt }], { maxTokens: 500 });
  try {
    const match = r.content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]).cards;
  } catch {}
  const facts = extractFacts(text);
  if (facts.length) {
    return facts.slice(0, n).map(f => {
      const splitAt = f.search(/[:.\u2014-]/);
      const front = (splitAt > 8 ? f.slice(0, splitAt) : f.slice(0, 48)).trim();
      return { front: front || f.slice(0, 40), back: f };
    });
  }
  return [{ front: 'Key term', back: 'Definition' }];
}