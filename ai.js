// ai.js — AI assistant using Gemini via the OpenAI-compatible endpoint.
// Falls back to a heuristic path when no API key is configured.
// Both paths are grounded in the user's note hierarchy (Subject > Topic > Subtopic > Note).
//
// Endpoint:  https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
// Auth:      Authorization: Bearer YOUR_GEMINI_API_KEY
// Response:  standard OpenAI shape — data.choices[0].message.content
//            or Server-Sent Events when streaming=true
import { AI_CONFIG } from './config.js';
import {
  getNotes, getNote, getNoteLinks, getSettings,
  getChildren, getDescendants, getSubjectNodes, getEffectiveSubject,
} from './storage.js';
import { daysUntil } from './ui.js';
import { getActiveNote } from './notes.js';

const SYSTEM_PROMPT = `You are Nexus AI, a study assistant inside a personal knowledge app called NexusLearn.
Be concise, practical, and grounded in the user's notes.
The user's notes are organised as a hierarchy: Subject > Topic > Subtopic > Note.
When the user asks about a topic, reference their own notes if relevant — including small details, not just headline facts.
Prefer short paragraphs and bullet points. Don't repeat the user's question.`;

// ── Core chat call ────────────────────────────────────────────
// `onToken` is an optional callback called with each streamed text chunk.
// When provided the call streams; otherwise it waits for the full response.
export async function aiChat(messages, opts = {}) {
  if (!AI_CONFIG.apiKey) return heuristicReply(messages);

  const grounded = groundingBlock();
  const full = [
    { role: 'system', content: SYSTEM_PROMPT + (grounded ? '\n\n' + grounded : '') },
    ...messages,
  ];

  const streaming = typeof opts.onToken === 'function';

  try {
    const res = await fetch(AI_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: full,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 800,
        stream: streaming,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { role: 'assistant', content: `AI error: ${res.status} ${errText.slice(0, 160)}`, error: true };
    }

    if (streaming) {
      return await readStream(res, opts.onToken);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '(no response)';
    return { role: 'assistant', content };

  } catch (err) {
    return { role: 'assistant', content: `Network error: ${err.message}`, error: true };
  }
}

// Reads an SSE stream from Gemini/OpenAI-compatible endpoint.
// Calls onToken(chunk) for each text delta, returns the full assembled reply.
async function readStream(res, onToken) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE lines look like: "data: {...}\n\n"
    const lines = buf.split('\n');
    buf = lines.pop() ?? ''; // keep the incomplete last line in the buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) { full += delta; onToken(delta); }
      } catch {
        // malformed chunk — skip
      }
    }
  }

  return { role: 'assistant', content: full || '(no response)' };
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
// Pulls bullets, callouts, and short standalone lines out of a note body
// so quizzes/flashcards are grounded in the user's actual wording.
export function extractFacts(body) {
  if (!body) return [];
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  const facts = [];
  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line)) continue;
    if (/^[-*]\s+/.test(line)) { facts.push(line.replace(/^[-*]\s+/, '').replace(/\*\*/g, '')); continue; }
    if (/^>\s+/.test(line))    { facts.push(line.replace(/^>\s+/, '')); continue; }
    if (line.length >= 12 && line.length <= 220) facts.push(line.replace(/\*\*/g, ''));
  }
  return [...new Set(facts)];
}

export function gatherFactsForTopic(topicTitle) {
  if (!topicTitle) return [];
  const all = getNotes();
  const root = all.find(n => n.title.toLowerCase() === topicTitle.trim().toLowerCase());
  const nodes = root
    ? [root, ...getDescendants(root.id)]
    : all.filter(n => getEffectiveSubject(n).toLowerCase() === topicTitle.trim().toLowerCase());
  const facts = [];
  for (const n of nodes)
    for (const f of extractFacts(n.body))
      facts.push({ fact: f, source: n.title, type: n.type || 'note' });
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
    return { role: 'assistant', content: `Quick quiz from "${topic}":\n1) Define the core idea in your own words.\n2) What links to it? (${links.length} links in your vault)\n3) Apply it to one new example.\n\n${facts.length ? `I found ${facts.length} fact(s) I can build real questions from — try "Generate quiz" in Materials/Tests.` : 'Add bullet points to your notes so I have facts to quiz you on.'}` };
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
      return { role: 'assistant', content: `Flashcard idea from "${node.title}":\nFront: "${facts[0].split(/[:.]/)[0].slice(0, 60)}"\nBack: "${facts[0]}"\n\nClick + in the Flashcards panel to add it.` };
    }
    return { role: 'assistant', content: `Add bullet points to "${node?.title || 'a note'}" and I can turn them straight into flashcards.` };
  }
  if (last.includes('connect') || last.includes('graph')) {
    if (!active) return { role: 'assistant', content: 'Open a note to see its connections.' };
    const kids = getChildren(active.id);
    const ancestor = getNote(active.parent_id);
    const conns = links.filter(l => l.source === active.id || l.target === active.id);
    return { role: 'assistant', content: `"${active.title}" [${active.type || 'note'}]${ancestor ? ` lives under "${ancestor.title}"` : ''} has ${kids.length} child node${kids.length === 1 ? '' : 's'} and ${conns.length} link${conns.length === 1 ? '' : 's'}. Open Graph view to see it — right-click a node to connect or create more.` };
  }

  const mentioned = notes.find(n => n.title && last.includes(n.title.toLowerCase()));
  if (mentioned) {
    const facts = extractFacts(mentioned.body).slice(0, 4);
    return { role: 'assistant', content: `From your "${mentioned.title}" note:\n${facts.length ? facts.map(f => '• ' + f).join('\n') : (mentioned.body || '(empty)').slice(0, 200)}` };
  }

  const counts = { subject: 0, topic: 0, subtopic: 0, note: 0 };
  for (const n of notes) counts[n.type || 'note'] = (counts[n.type || 'note'] || 0) + 1;
  const subjectNames = getSubjectNodes().map(s => s.title).join(', ');
  const examDays = daysUntil(getSettings().examDate);
  return {
    role: 'assistant',
    content: `Vault: ${counts.subject} subject${counts.subject === 1 ? '' : 's'}${subjectNames ? ` (${subjectNames})` : ''}, ${counts.topic} topic${counts.topic === 1 ? '' : 's'}, ${counts.subtopic} subtopic${counts.subtopic === 1 ? '' : 's'}, ${counts.note} note${counts.note === 1 ? '' : 's'}. ${examDays != null ? `Exam in ${examDays} days. ` : ''}Try "quiz me on <topic>", "summarise <note>", or just ask anything. (Add your Gemini API key in config.js for real AI responses.)`,
  };
}

// ── Quiz generation ───────────────────────────────────────────
export async function aiGenerateQuiz(topic) {
  const facts = gatherFactsForTopic(topic);
  const factsBlock = facts.length
    ? `\n\nFacts from the user's own notes — ground your questions in these:\n${facts.map(f => `- ${f.fact} (from "${f.source}")`).join('\n')}`
    : '';
  const prompt = `Generate a 5-question multiple choice quiz on "${topic}". Return STRICT JSON: {"items":[{"q":"...","opts":["A","B","C","D"],"answer":0,"explain":"..."}]}. No prose, no markdown fences.${factsBlock}`;
  const r = await aiChat([{ role: 'user', content: prompt }], { temperature: 0.3, maxTokens: 1200 });
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
    { q: `Which concept is most related to "${topic}"?`, opts: ['Analogy', 'Example', 'Definition', 'None'], answer: 0, explain: 'Open a related note to confirm.' },
    { q: `Give one real-world example of "${topic}".`, opts: ['—', '—', '—', '—'], answer: 0, explain: 'Open-ended.' },
    { q: `What is a common mistake when studying "${topic}"?`, opts: ['Skipping foundations', 'Over-memorising', 'Ignoring examples', 'All of the above'], answer: 3, explain: 'All three are real pitfalls.' },
    { q: `Apply "${topic}" to a problem you haven't seen before.`, opts: ['—', '—', '—', '—'], answer: 0, explain: 'Open-ended.' },
  ];
}

function buildFactQuiz(topic, facts, n = 5) {
  const pool = shuffle(facts);
  const picked = pool.slice(0, Math.min(n, pool.length));
  return picked.map(f => {
    const distractors = shuffle([...new Set(pool.filter(x => x.fact !== f.fact).map(x => x.fact))]).slice(0, 3);
    while (distractors.length < 3) distractors.push('None of the above');
    const opts = shuffle([f.fact, ...distractors]);
    return {
      q: `According to your "${f.source}" note, which statement about ${topic} is correct?`,
      opts,
      answer: opts.indexOf(f.fact),
      explain: `Pulled from your "${f.source}" note.`,
    };
  });
}

// ── Summarize / Flashcards ────────────────────────────────────
export async function aiSummarize(text) {
  if (!text) return '(empty)';
  const r = await aiChat(
    [{ role: 'user', content: `Summarize this note in 3 concise bullet points:\n\n${text.slice(0, 4000)}` }],
    { maxTokens: 300 }
  );
  return r.content;
}

export async function aiFlashcards(text, n = 5) {
  const prompt = `Generate ${n} flashcards from this note. Return STRICT JSON: {"cards":[{"front":"...","back":"..."}]}. No prose, no markdown fences.\n\n${text.slice(0, 4000)}`;
  const r = await aiChat([{ role: 'user', content: prompt }], { maxTokens: 600 });
  try {
    const match = r.content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]).cards;
  } catch {}
  // Heuristic fallback: derive front/back from extracted fact lines
  const facts = extractFacts(text);
  if (facts.length) {
    return facts.slice(0, n).map(f => {
      const splitAt = f.search(/[:.\u2014]/);
      const front = (splitAt > 8 ? f.slice(0, splitAt) : f.slice(0, 48)).trim();
      return { front: front || f.slice(0, 40), back: f };
    });
  }
  return [{ front: 'Key term', back: 'Definition' }];
}