// config.js — central place for credentials & runtime constants.

export const SUPABASE_CONFIG = {
  url: 'https://xgkoooesqzptengdfjjg.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhna29vb2VzcXpwdGVuZ2RmampnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNzYzMTIsImV4cCI6MjA5Nzk1MjMxMn0.q3papNDZUMFQhiroDves22-2wUewhjer0AhUfy-UVXQ',
};

export const AI_CONFIG = {
  // Your Google AI Studio key (aistudio.google.com/app/apikey)
  // Works with both old AIza... keys and new AQ... keys.
  apiKey: 'AQ.Ab8RN6L_ZH8La_dZg7hjnkfwJALN486GewgHYQuGsJ50zgiNoQ',

  // Native Gemini REST endpoint — more reliable than the OpenAI-compatible
  // path, especially for new AQ. prefix keys. The model name is appended
  // at call time: /v1beta/models/gemini-2.5-flash:generateContent
  endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',

  // gemini-2.5-flash: fast, cheap, excellent for a study assistant.
  // Other options: 'gemini-2.5-pro' (smarter), 'gemini-2.0-flash' (older free tier)
  model: 'gemini-2.5-flash',
};

export const APP_CONFIG = {
  brand: 'Ad Astra',
  localUserId: 'local',
  defaultAccent: '#6F00FF',
  defaultAccentBright: '#A966FF',
};
