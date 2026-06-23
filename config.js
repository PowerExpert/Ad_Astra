// config.js — central place for credentials & runtime constants.
// The user is hardcoding these later. Leave them empty for now;
// storage.js will detect that and fall back to localStorage only.

export const SUPABASE_CONFIG = {
  // TODO: hardcode here — Supabase project URL, e.g. "https://abc.supabase.co"
  url: '',
  // TODO: hardcode here — Supabase anon public key
  anonKey: '',
};

export const AI_CONFIG = {
  apiKey: 'uE4O0MRUtxnw1xlr1BcbCRldAQFHoL4aD4VFTkl1',
  model: 'command-r-plus-08-2024',
  endpoint: 'https://api.cohere.com/v2/chat',
};

export const APP_CONFIG = {
  brand: 'NexusLearn',
  localUserId: 'local',
  defaultAccent: '#6F00FF',
  defaultAccentBright: '#A966FF',
};