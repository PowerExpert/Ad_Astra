// auth.js — shared Supabase auth helpers used by login.html, index.html
// (project hub) and app.html. Centralizes "who is signed in" so every
// page agrees, instead of each page reinventing session handling.
//
// Local mode (no SUPABASE_CONFIG filled in): there are no accounts, so
// every helper here treats that as "signed in as a shared local user" and
// never redirects to login — this keeps the offline/no-setup experience
// working exactly as it did before.
import { SUPABASE_CONFIG } from './config.js';

let supabasePromise = null;

export function isConfigured() {
  return !!(SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey);
}

// Lazily creates (once) and returns the Supabase client, or null when
// Supabase isn't configured.
export function getSupabaseClient() {
  if (!isConfigured()) return Promise.resolve(null);
  if (!supabasePromise) {
    supabasePromise = import('https://esm.sh/@supabase/supabase-js@2')
      .then(mod => mod.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      }))
      .catch(err => { console.warn('Supabase client init failed', err); return null; });
  }
  return supabasePromise;
}

export async function getSession() {
  const sb = await getSupabaseClient();
  if (!sb) return null;
  try {
    const { data } = await Promise.race([
      sb.auth.getSession(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('getSession timed out')), 4000)),
    ]);
    return data.session || null;
  } catch (err) {
    console.warn('getSession failed', err);
    return null;
  }
}

export async function getUser() {
  const session = await getSession();
  return session?.user || null;
}

// Call at the top of any page that requires a signed-in account.
// Returns { user, local } — local:true means Supabase isn't configured at
// all, so there's no login wall (shared local vault, same as before).
// Returns null (and redirects) when Supabase IS configured but nobody is
// signed in.
export async function requireAuth(redirectTo = 'login.html') {
  if (!isConfigured()) return { user: { id: 'local', email: 'local' }, local: true };
  const user = await getUser();
  if (!user) { location.href = redirectTo; return null; }
  return { user, local: false };
}

export async function signOutAndRedirect(redirectTo = 'login.html') {
  const sb = await getSupabaseClient();
  if (sb) { try { await sb.auth.signOut(); } catch (err) { console.warn('signOut failed', err); } }
  location.href = redirectTo;
}

export function onAuthChange(cb) {
  let unsub = () => {};
  getSupabaseClient().then(sb => {
    if (!sb) return;
    const { data } = sb.auth.onAuthStateChange((_event, session) => cb(session?.user || null));
    unsub = () => data.subscription.unsubscribe();
  });
  return () => unsub();
}
