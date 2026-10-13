// Copied from swyphd/permadeath-media kit/ at a8cfaa0. Edit it there, then re-run kit/sync.mjs.
// Saves: the browser save every game needs, plus Hedy Plant's cloud save
// (src/site.jsx in hedy-plant) made game-agnostic.
//
// Playing never needs an account. The local save always works on its own; the
// cloud save is an offer (an emailed login link, no password) that keeps the run
// in Supabase's game_saves table (game-saves.sql), one row per player per game,
// so it survives a cleared browser and opens on any device.

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

// ---------- local ----------
// createLocalSave({ key, version, migrate })
//   key       the localStorage key ('guild-rising-save')
//   version   bump it when old saves can't be read; `migrate(data, fromVersion)`
//             returns a usable state, or null to start over
// Stored as { v, at, data }; an older bare save reaches `migrate` as version 0. `savedAt` is when the save that was there at page
// load was written (null if none), which the cloud save uses to pick a winner.
export function createLocalSave({ key, version = 1, migrate = null } = {}) {
  if (!key) throw new Error('createLocalSave needs a key');

  function read() {
    try {
      const raw = storage()?.getItem(key);
      if (!raw) return null;
      const box = JSON.parse(raw);
      if (box == null) return null;
      // A save written before the game used the kit (a bare state object) reads as
      // version 0, so `migrate` can adopt it instead of throwing the run away.
      if (typeof box !== 'object' || !('data' in box) || !('v' in box)) return { v: 0, at: null, data: box };
      return box;
    } catch { return null; }
  }

  const atLoad = read();
  const save = {
    key,
    version,
    savedAt: atLoad?.at ?? null,
    // The saved state, migrated to this version, or null.
    load() {
      const box = read();
      if (!box) return null;
      if (box.v === version) return box.data;
      return migrate ? migrate(box.data, box.v) ?? null : null;
    },
    // Returns false when storage is full or blocked (private mode), so the game can say so.
    write(data) {
      try {
        storage().setItem(key, JSON.stringify({ v: version, at: Date.now(), data }));
        return true;
      } catch { return false; }
    },
    clear() { try { storage()?.removeItem(key); } catch {} },
    lastWrite: () => read()?.at ?? null,
  };
  return save;
}

// ---------- cloud ----------
// createCloudSave({ game, getState, setState, savedAt, progress })
//   game        the game_saves.game value ('hedy-plant'), at most 40 characters
//   getState()  the live state to upload; setState(data) swaps in the cloud's copy
//   savedAt     ms of the local save before this page load (createLocalSave().savedAt)
//   progress(s) how far a run has got (Hedy: s.t, its shift-clock seconds)
//   supabase    a client, or left out to build one from window.supabase (the UMD
//               script in config.js SUPABASE_SCRIPT) with the studio project
// Which run wins when both exist: right after a sign-in by link, the one with more
// progress (the player most likely wants the run they've put more into); on an
// ordinary page load, the more recently saved one.
//
// The page the link returns to must be listed under Supabase > Authentication >
// URL Configuration > Redirect URLs. Without a Supabase client (tests, offline)
// `available` is false and the game simply doesn't offer it.
export function createCloudSave({
  game, getState, setState, savedAt = null, progress = () => 0,
  supabase = null, pushEvery = 30000, redirectTo = null,
} = {}) {
  if (!game) throw new Error('createCloudSave needs a game');
  const win = typeof window !== 'undefined' ? window : null;
  const lib = win?.supabase;
  const sb = supabase || (lib?.createClient ? lib.createClient(SUPABASE_URL, SUPABASE_KEY) : null);
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f(cloud));
  const cloud = {
    available: !!sb, email: null, lastPush: null, note: '',
    on(f) { listeners.add(f); return () => listeners.delete(f); },
    setNote(text) { cloud.note = text; emit(); },
  };
  if (!sb) {
    cloud.sendLink = async () => { throw new Error('Cloud saves are unavailable right now.'); };
    cloud.push = async () => {};
    cloud.signOut = async () => {};
    cloud.ready = Promise.resolve();
    return cloud;
  }

  const loc = win?.location;
  const freshLink = !!loc && /access_token=|[?&]code=/.test((loc.hash || '') + (loc.search || ''));
  let user = null;
  let pulled = false;
  let timer = null;

  cloud.push = async () => {
    if (!user) return false;
    const { error } = await sb.from('game_saves').upsert(
      { user_id: user.id, game, data: getState(), updated_at: new Date().toISOString() },
      { onConflict: 'user_id,game' },
    );
    if (error) return false;
    cloud.lastPush = Date.now();
    emit();
    return true;
  };

  async function pull() {
    const { data, error } = await sb.from('game_saves').select('data, updated_at').eq('game', game).maybeSingle();
    if (error) return;
    if (!data) { await cloud.push(); return; }
    const remoteWins = freshLink
      ? (progress(data.data) ?? 0) > (progress(getState()) ?? 0)
      : !savedAt || Date.parse(data.updated_at) > savedAt;
    if (remoteWins) {
      setState(data.data);
      cloud.note = 'Loaded your save from the cloud.';
      cloud.lastPush = Date.parse(data.updated_at);
      emit();
    } else {
      await cloud.push();
    }
  }

  let pulling = Promise.resolve();
  function signedIn(session) {
    user = session?.user ?? null;
    cloud.email = user?.email ?? null;
    if (user && !pulled) { pulled = true; pulling = pull(); }
    if (user && !timer && pushEvery) timer = setInterval(cloud.push, pushEvery);
    if (!user && timer) { clearInterval(timer); timer = null; }
    emit();
  }

  cloud.ready = sb.auth.getSession().then(({ data }) => { signedIn(data.session); return pulling; });
  sb.auth.onAuthStateChange((_event, session) => signedIn(session));
  const doc = win?.document;
  const onHide = () => { if (doc.visibilityState === 'hidden') cloud.push(); };
  doc?.addEventListener?.('visibilitychange', onHide);

  cloud.sendLink = async (email) => {
    const to = redirectTo || (loc ? loc.origin + loc.pathname : undefined);
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: to } });
    if (error) throw error;
  };
  cloud.signOut = async () => {
    await cloud.push();
    await sb.auth.signOut();
    pulled = false;
    cloud.note = '';
    signedIn(null);
  };
  // Stops the timer and listeners (tests, or a game tearing down its page).
  cloud.dispose = () => {
    if (timer) clearInterval(timer);
    timer = null;
    doc?.removeEventListener?.('visibilitychange', onHide);
    listeners.clear();
  };
  return cloud;
}
