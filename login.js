// login.js — dedicated sign in / sign up page logic.
import { getSupabaseClient, isConfigured, getUser } from './auth.js';
import { $, $$ } from './ui.js';

const emailInput = $('#login-email');
const pwInput    = $('#login-password');
const errEl      = $('#login-error');
const submitBtn  = $('#login-submit');
const noteEl     = $('#login-note');
const bannerHost = $('#login-banner-host');
const tabs       = $$('.login-tab');

let mode = 'signin';

// Races an auth call against a hard timeout so a paused/unreachable
// Supabase project fails fast with a clear message instead of leaving the
// button stuck on "Signing in…"/"Creating account…" indefinitely.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

// supabase-js reports a network-level failure (DNS/CORS/offline/paused
// project) as error.message === 'Failed to fetch' — distinct from real
// auth errors like "Invalid login credentials", which come back with
// their own message. Give that specific case a more useful explanation.
function friendlyAuthError(err) {
  if (err?.message === 'Failed to fetch' || /timed out$/.test(err?.message || '')) {
    return 'Could not reach the server. The Supabase project may be paused (free tier auto-pauses after ~1 week idle — check the dashboard and resume it) or you may be offline. Try again in a minute.';
  }
  return err?.message || 'Something went wrong. Please try again.';
}

function setMode(m) {
  mode = m;
  tabs.forEach(t => t.classList.toggle('active', t.dataset.mode === m));
  submitBtn.textContent = m === 'signin' ? 'Sign in' : 'Create account';
  noteEl.textContent = m === 'signin'
    ? 'Don\'t have an account? Click "Sign up" above.'
    : 'Already have an account? Click "Sign in" above.';
  errEl.textContent = '';
}
tabs.forEach(t => {
  t.addEventListener('click', () => setMode(t.dataset.mode));
  t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMode(t.dataset.mode); } });
});

async function init() {
  if (!isConfigured()) {
    bannerHost.appendChild(Object.assign(document.createElement('div'), {
      className: 'login-banner',
      textContent: 'Supabase isn\'t configured in config.js — running in local mode, so there\'s nothing to sign in to. Redirecting…',
    }));
    submitBtn.disabled = true;
    setTimeout(() => { location.href = 'index.html'; }, 1600);
    return;
  }
  // Already signed in? Skip straight to the project hub.
  const user = await getUser();
  if (user) { location.href = 'index.html'; return; }
}
init();

async function submit() {
  if (submitBtn.disabled) return;
  const email = emailInput.value.trim();
  const password = pwInput.value;
  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = 'Email and password are required.'; return; }

  const sb = await getSupabaseClient();
  if (!sb) { errEl.textContent = 'Auth is not available right now.'; return; }

  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = mode === 'signin' ? 'Signing in…' : 'Creating account…';

  let data, error;
  try {
    const call = mode === 'signin'
      ? sb.auth.signInWithPassword({ email, password })
      : sb.auth.signUp({ email, password });
    ({ data, error } = await withTimeout(call, 8000, mode === 'signin' ? 'Sign in' : 'Sign up'));
  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
    errEl.textContent = friendlyAuthError(err);
    return;
  }

  submitBtn.disabled = false;
  submitBtn.textContent = originalLabel;

  if (error) { errEl.textContent = friendlyAuthError(error); return; }

  if (mode === 'signup' && !data.session) {
    // Email confirmation required before a session exists.
    noteEl.textContent = 'Check your email to confirm your account, then sign in.';
    setMode('signin');
    return;
  }

  location.href = 'index.html';
}

submitBtn.addEventListener('click', submit);
[emailInput, pwInput].forEach(inp => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));