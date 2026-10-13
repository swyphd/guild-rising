// Copied from swyphd/permadeath-media kit/ at a8cfaa0. Edit it there, then re-run kit/sync.mjs.
// Play analytics: what happens in runs, so the studio can say how games actually
// play (win rates, where people quit, which choices they make) instead of only
// describing the design.
//
//   const stats = createAnalytics({ game: 'hedy-plant', version: '2026-10-13' });
//   stats.runStart();                                   a new playthrough
//   stats.milestone('first_letter', { t: s.t });        progress points, in order
//   stats.choice('federation_terms', 'accept', { t });   a decision and what was picked
//   stats.runEnd('win', { t, ending: 'buyout' });       'win' | 'loss' | 'quit' (gave up from a menu)
//   stats.progress(() => ({ t: s.t, tier: s.tier }));   read when the tab closes mid-run
//
// A run that starts and never ends is a player who left; the last milestone
// before that is where they quit (see the read-outs in game-events.sql).
//
// Events are batched and posted to the site's /api/events (game_events table).
// No emails, names or IPs: a player is a random id the browser makes up. A
// browser with Do Not Track or Global Privacy Control sends nothing, and
// `optOut()` stops it for good on this device. Analytics never throws into the
// game and never blocks play.
import { SITE_ORIGIN } from './config.js';

export const EVENTS_URL = `${SITE_ORIGIN}/api/events`;
const PLAYER_KEY = 'pm-player';
const OPTOUT_KEY = 'pm-analytics-off';
const MAX_BATCH = 50;

const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const get = (k) => { try { return storage()?.getItem(k) ?? null; } catch { return null; } };
const set = (k, v) => { try { storage()?.setItem(k, v); } catch {} };

export function newId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

// The browser asked not to be tracked.
export function privacySignal(nav = globalThis.navigator) {
  if (!nav) return false;
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1' || nav.doNotTrack === 'yes';
}

export function createAnalytics({
  game, version = null, url = EVENTS_URL, flushEvery = 10000, batchSize = 20,
  fetch: fetchImpl = null, beacon = null, navigator: nav = globalThis.navigator,
  clock = () => Date.now(), enabled = true,
} = {}) {
  if (!game) throw new Error('createAnalytics needs a game');
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const doBeacon = beacon || ((u, body) => (nav?.sendBeacon ? nav.sendBeacon(u, body) : false));

  let player = get(PLAYER_KEY);
  const on = () => enabled && !get(OPTOUT_KEY) && !privacySignal(nav);
  if (!player && on()) { player = newId(); set(PLAYER_KEY, player); }
  const session = newId();
  let run = null;
  let runStartedAt = null;
  let queue = [];
  let timer = null;
  let readProgress = null;

  const base = () => ({ game, game_version: version, player, session, run });

  function track(name, props = {}) {
    if (!on()) return;
    try {
      if (!player) { player = newId(); set(PLAYER_KEY, player); }
      const t = props.t ?? (runStartedAt != null ? (clock() - runStartedAt) / 1000 : null);
      const { t: _drop, ...rest } = props;
      queue.push({ ...base(), name, props: rest, t });
      if (queue.length >= batchSize) flush();
      else if (!timer && flushEvery) timer = setTimeout(flush, flushEvery);
    } catch {}
  }

  async function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length) return true;
    const events = queue.splice(0, MAX_BATCH);
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
        keepalive: true,
      });
      if (queue.length) return flush();
      return !!res?.ok;
    } catch {
      return false; // dropped: analytics is best-effort and never retries forever
    }
  }

  // The tab is going away: record where the run stood and send by beacon, which
  // survives the page closing. text/plain keeps it a simple cross-origin request.
  // Fires on every hide (a tab switch too, since mobile browsers may never send
  // pagehide); session_end is recorded once per hide, and play after coming back
  // carries on in the same session.
  let ended = false;
  function leave() {
    if (!on()) return;
    if (!ended) {
      ended = true;
      track('session_end', run ? { ...(safeProgress() || {}), mid_run: true } : {});
    }
    if (timer) { clearTimeout(timer); timer = null; }
    while (queue.length) {
      const events = queue.splice(0, MAX_BATCH);
      const body = JSON.stringify({ events });
      let sent = false;
      try { sent = doBeacon(url, body); } catch {}
      if (!sent) { try { doFetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true }).catch(() => {}); } catch {} }
    }
  }
  function safeProgress() { try { return readProgress ? readProgress() : null; } catch { return null; } }

  const win = typeof window !== 'undefined' ? window : null;
  const onHide = () => { if (win.document?.visibilityState === 'hidden') leave(); else ended = false; };
  win?.addEventListener?.('pagehide', leave);
  win?.document?.addEventListener?.('visibilitychange', onHide);

  const api = {
    game,
    get player() { return player; },
    session,
    get run() { return run; },
    get enabled() { return on(); },
    track,
    // A resumed save keeps its run id: pass it back as `resume` (store stats.run in the save).
    runStart(props = {}, { resume = null } = {}) {
      run = resume || newId();
      runStartedAt = clock() - (props.t ?? 0) * 1000;
      track(resume ? 'run_resume' : 'run_start', props);
      return run;
    },
    runEnd(outcome, props = {}) {
      if (!run) return;
      track('run_end', { outcome, ...props });
      run = null;
      runStartedAt = null;
      flush();
    },
    milestone(name, props = {}) { track('milestone', { milestone: name, ...props }); },
    choice(id, option, props = {}) { track('choice', { choice: id, option: String(option), ...props }); },
    progress(fn) { readProgress = fn; },
    flush,
    leave,
    optOut() { set(OPTOUT_KEY, '1'); queue = []; },
    optIn() { try { storage()?.removeItem(OPTOUT_KEY); } catch {} },
    pending: () => queue.length,
    dispose() {
      if (timer) clearTimeout(timer);
      win?.removeEventListener?.('pagehide', leave);
      win?.document?.removeEventListener?.('visibilitychange', onHide);
    },
  };
  return api;
}
