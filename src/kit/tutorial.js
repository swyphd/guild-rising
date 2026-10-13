// Copied from swyphd/permadeath-media kit/ at a8cfaa0. Edit it there, then re-run kit/sync.mjs.
// The tutorial engine, from Guild Rising's Tutorial.jsx and Card Check's TUT /
// CALLOUTS, with the rendering left to the game (each game draws its guide card
// in its own look). This module only decides which step shows, when the game
// should pause, and remembers what the player has seen.
//
// The studio's rule for tutorials: give the player a task and let them explore,
// the way a first-person game says "here's how to walk, now leave the room", not
// "take this step, then this step, then click the doorknob". So a step is a GOAL
// the player can reach any way they like: it teaches the one thing they need,
// names the outcome, and finishes when the outcome is true, however they got
// there. The controls stay open; nothing is greyed out to force the next click.
// If the player stalls, hints come in stages, the vaguest first.
//
// A step:
//   { id, title, body,           what the guide card says: the skill, then the goal
//                                (any extra fields pass through: target, pos ... are
//                                the game's to use)
//     when?(game),               it may show only while this holds (default: always)
//     goal?(game),               a GOAL step: it finishes when this holds, and the game
//                                keeps running. Test the outcome ("the treasury holds
//                                20 coins"), not the click that usually gets there.
//     hints?: [{ after, body }], for a player who seems stuck: each shows once `after`
//                                seconds have passed on this step (or `after(game, secs)`
//                                holds). tutorial.hint(game) returns the latest due one.
//     done?(game),               the older name for `goal`; same thing
//     next?: true }              forces a read step even with a goal (Card Check's style)
// A step with neither `goal` nor `done` is a READ step: the game pauses until
// "Got it" (next()). Keep them few and short; the game is the teacher.
//
// checkSteps(steps) flags steps that break the rule (a step that locks the controls
// with `allow`, long runs of one-click steps), so a game's tests can hold the line.
//
// Two modes:
//   'contextual' (Guild Rising, Card Check's callouts): the first unseen step whose
//       `when` holds is shown, so each mechanic is introduced the first time it matters.
//   'scripted' (a guided first game): steps run in order; a goal step advances on its
//       own as soon as its goal holds. Card Check's guided game is the cautionary case:
//       dozens of steps, most of them one click with the rest of the board locked.
//
// Status: 'new' (the welcome is up: start() or skip()), 'active', 'skipped', 'done'.
// `autoStart: true` skips the welcome (callouts). Progress is kept in localStorage
// under `key`; pass `persist: false` to keep it in memory and store snapshot() in
// the game's own save instead (a scripted tutorial game, like Card Check's).
//
// Typical loop: every render or tick call `tutorial.observe(game)`, which returns the
// step to show (or null), and skip the game's tick while `tutorial.paused(game)`.

const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

const goalOf = (s) => (typeof s?.goal === 'function' ? s.goal : typeof s?.done === 'function' ? s.done : null);
export const isActionStep = (s) => !!goalOf(s) && !s.next;
export const isGoalStep = isActionStep;

// Ways a step list drifts from "give a task, let them explore". Returns readable
// warnings; an empty list means the tutorial keeps to the rule.
//   maxInARow  how many goal steps may follow each other before the tutorial reads
//              as a click-by-click script (default 3)
export function checkSteps(steps, { maxInARow = 3, maxReadWords = 60 } = {}) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length > maxInARow) out.push(`${run.length} goal steps in a row (${run.join(', ')}): merge them into one goal and let the player find the route`);
    run = [];
  };
  for (const s of steps) {
    if (s.allow) out.push(`${s.id}: \`allow\` locks every other control; state the goal and leave the game open`);
    if (isActionStep(s)) run.push(s.id);
    else {
      flush();
      const words = String(s.body || '').split(/\s+/).filter(Boolean).length;
      if (words > maxReadWords) out.push(`${s.id}: a ${words}-word read step pauses play; cut it or teach it through a goal`);
    }
  }
  flush();
  return out;
}

export function createTutorial({
  key = null, version = 1, steps, mode = 'contextual', autoStart = false,
  persist = true, parts = null, hidden = () => false, initial = null,
  clock = () => Date.now(),
} = {}) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('createTutorial needs steps');
  if (mode !== 'contextual' && mode !== 'scripted') throw new Error(`unknown tutorial mode ${mode}`);
  const save = persist && key;
  const fresh = () => ({ v: version, status: autoStart ? 'active' : 'new', seen: [], index: 0 });

  function load() {
    if (initial) return { ...fresh(), ...initial, v: version };
    if (!save) return fresh();
    try {
      const raw = JSON.parse(storage()?.getItem(key) || 'null');
      if (raw && raw.v === version && Array.isArray(raw.seen)) return { ...fresh(), ...raw };
    } catch {}
    return fresh();
  }

  let state = load();
  let shown = null; // id of the step showing at the last observe()
  let shownAt = null; // when that step first showed, for hints
  const listeners = new Set();
  const commit = (next) => {
    state = next;
    if (save) { try { storage()?.setItem(key, JSON.stringify(state)); } catch {} }
    listeners.forEach((f) => f(state));
  };
  const when = (s, g) => !s.when || !!s.when(g);
  const finish = () => commit({ ...state, status: 'done' });

  function markSeen(id) {
    if (state.seen.includes(id)) return;
    const seen = [...state.seen, id];
    commit({ ...state, seen, ...(mode === 'contextual' && steps.every((s) => seen.includes(s.id)) ? { status: 'done' } : {}) });
  }

  // The step that should show now, without changing anything.
  function current(game) {
    if (state.status !== 'active') return null;
    if (mode === 'scripted') return steps[state.index] || null;
    return steps.find((s) => !state.seen.includes(s.id) && when(s, game)) || null;
  }

  // Moves the tutorial along with the game and returns the step to show.
  function observe(game) {
    if (state.status !== 'active') { show(null); return null; }
    if (mode === 'scripted') {
      // action steps the game has already satisfied fall through (a chain of them can)
      let guard = 0;
      while (guard++ < steps.length && state.index < steps.length) {
        const s = steps[state.index];
        if (!isActionStep(s) || !goalOf(s)(game)) break;
        commit({ ...state, index: state.index + 1, seen: [...state.seen, s.id] });
      }
      if (state.index >= steps.length) { finish(); show(null); return null; }
      show(steps[state.index].id);
      return steps[state.index];
    }
    // contextual: an action step that was showing is finished once the player did it,
    // or retired once it stops applying (the vote closed without them) so it never
    // comes back stale; a read step hidden by a modal waits and comes back.
    if (shown) {
      const prev = steps.find((s) => s.id === shown);
      if (prev && isActionStep(prev) && !state.seen.includes(prev.id)
        && (goalOf(prev)(game) || (!when(prev, game) && !hidden(game)))) markSeen(prev.id);
    }
    let step = current(game);
    while (step && isActionStep(step) && goalOf(step)(game)) { markSeen(step.id); step = current(game); }
    show(step?.id || null);
    return step;
  }

  function show(id) {
    if (id !== shown) shownAt = id ? clock() : null;
    shown = id;
  }

  const api = {
    get status() { return state.status; },
    get seen() { return [...state.seen]; },
    get index() { return state.index; },
    steps,
    current,
    observe,
    // The game should not tick: the welcome is up, or a read step is showing.
    paused(game) {
      if (state.status === 'new') return true;
      const s = current(game);
      return !!s && !isActionStep(s);
    },
    start() { commit({ ...state, status: 'active' }); },
    skip() { commit({ ...state, status: 'skipped' }); },
    replay() { show(null); commit({ ...fresh(), status: 'active' }); },
    // "Got it" on a read step, or "dismiss" on an action step.
    next(game) {
      const s = current(game);
      if (!s) return;
      if (mode === 'scripted') {
        const index = state.index + 1;
        commit({ ...state, index, seen: [...state.seen, s.id] });
        if (index >= steps.length) finish();
      } else markSeen(s.id);
    },
    markSeen,
    // The latest hint that's due for the step showing now, or null. Call after observe().
    hint(game) {
      const s = steps.find((x) => x.id === shown);
      if (!s?.hints?.length || shownAt == null) return null;
      const secs = (clock() - shownAt) / 1000;
      let due = null;
      for (const h of s.hints) {
        const ok = typeof h.after === 'function' ? h.after(game, secs) : secs >= (h.after ?? 0);
        if (ok) due = h;
      }
      return due;
    },
    // Card Check's progress bar: which part this step is in, and where in that part.
    // parts: [{ name, from }] with `from` the index of the part's first step.
    progress() {
      if (!parts || mode !== 'scripted') return null;
      let i = 0;
      parts.forEach((p, k) => { if (state.index >= p.from) i = k; });
      const from = parts[i].from;
      const to = i + 1 < parts.length ? parts[i + 1].from : steps.length;
      return { part: i, parts: parts.length, name: parts[i].name, step: state.index - from + 1, of: to - from };
    },
    snapshot: () => ({ ...state, seen: [...state.seen] }),
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
  };
  return api;
}
