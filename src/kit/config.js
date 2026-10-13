// Copied from swyphd/permadeath-media kit/ at a8cfaa0. Edit it there, then re-run kit/sync.mjs.
// Studio-wide constants every game shares. The Supabase key is the public
// (publishable) one every page already carries; row-level security in
// game-saves.sql and newsletter-signups.sql decides what it can do.
export const SITE_ORIGIN = 'https://permadeathmedia.com';
// Absolute so a game served from its own *.vercel.app preview still reaches it
// (the endpoint answers any origin).
export const SIGNUP_URL = `${SITE_ORIGIN}/api/subscribe`;
export const SUPABASE_URL = 'https://kmxkuyloybrdtcdiiqwo.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_RI26gdJieUSoWA68DsfwwQ_qYte5CLj';
// The UMD build that sets window.supabase, for pages without a bundler.
export const SUPABASE_SCRIPT = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
