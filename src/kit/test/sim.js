// Copied from swyphd/permadeath-media kit/ at a8cfaa0. Edit it there, then re-run kit/sync.mjs.
// Bots and simulations, from Hedy Plant's tests/bots.mjs (a scripted player run
// through the real engine for pacing) and Union Up's sim/ (seeded, replayable runs
// and a fuzzer that checks invariants every turn). The point, as Union Up's sim
// README puts it: the bots drive the game's own engine, so they can't drift from it.
//
// Everything here takes the game's functions; nothing knows about any one game.
import { createRng } from '../rng.js';

// SEED=7 node sim/x.mjs  ->  a replayable run. Unset, the run is as random as the game.
// Pass the game's own rng (createRng) so the engine and the bots share one source.
export function seedFromEnv(rng, env = globalThis.process?.env || {}) {
  if (env.SEED != null && env.SEED !== '') rng.seed(env.SEED);
  return rng;
}

// Runs one game with a bot at the controls.
//   init()                  a fresh game state
//   bot(state, t, log)      the player's move, called before each step
//   step(state, dt)         the engine's tick (real-time games) or turn (turn-based: dt = 1)
//   done?(state)            stop early (a win or a loss)
//   sample?(state, t)       record something each tick, kept in `samples`
//   events?(state)          the game's event list (Hedy's inbox); new entries are logged
// Returns { state, t, log, samples }.
export function simulate({ init, bot = () => {}, step, dt = 1, duration = 100, done = () => false, sample = null, events = null }) {
  const state = init();
  const log = [];
  const samples = [];
  let seenEvents = 0;
  let t = 0;
  for (; t < duration; t += dt) {
    bot(state, t, log);
    step(state, dt);
    if (events) { const list = events(state) || []; while (seenEvents < list.length) log.push(list[seenEvents++]); }
    if (sample) samples.push(sample(state, t + dt));
    if (done(state)) { t += dt; break; }
  }
  return { state, t, log, samples };
}

// Plays many games and tallies what came out: compare bots (a greedy optimizer
// against an organizer) by running `outcome` over each finished game.
//   runMany(n, { seed, rng, ...simulate options, outcome(result) => string|number })
// Returns { n, counts: { outcome: games }, values: [...], mean } for numeric outcomes.
export function runMany(n, { rng = null, seed = null, outcome = (r) => r.state, ...opts }) {
  const counts = {};
  const values = [];
  for (let i = 0; i < n; i++) {
    if (rng && seed != null) rng.seed(`${seed}:${i}`);
    const v = outcome(simulate(opts));
    values.push(v);
    if (typeof v !== 'number') counts[v] = (counts[v] || 0) + 1;
  }
  const nums = values.filter((v) => typeof v === 'number');
  return { n, counts, values, mean: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null };
}

// Union Up's fuzzer: random and adversarial moves through the real engine, with
// invariants checked after every step, and no mutation of the state it was handed.
//   plan(state, rng)          a random move
//   apply(state, move)        returns the next state (pure engines) or mutates (then
//                             set `mutates: true` and the immutability check is skipped)
//   check(state, bad, label)  call bad(kind, detail) for each broken invariant
// Returns { problems: { kind: { n, detail } }, clean }. `detail` is the first case seen.
export function fuzz({ games = 100, turns = 50, seed = 1, init, plan, apply, check, mutates = false, done = () => false }) {
  const rng = createRng(seed);
  const problems = {};
  const bad = (kind, detail) => { if (!problems[kind]) problems[kind] = { n: 0, detail }; problems[kind].n++; };
  for (let g = 0; g < games; g++) {
    let state = init(rng, g);
    for (let turn = 0; turn < turns && !done(state); turn++) {
      const move = plan(state, rng);
      const before = mutates ? null : JSON.stringify(state);
      let next;
      try { next = apply(state, move); } catch (e) { bad('threw', `game ${g} turn ${turn}: ${e.message}`); break; }
      if (!mutates && JSON.stringify(state) !== before) bad('mutated its input', `game ${g} turn ${turn}`);
      state = mutates ? state : next;
      check(state, bad, `game ${g} turn ${turn}`);
    }
  }
  return { problems, clean: Object.keys(problems).length === 0 };
}

// Same seed, same game: runs `run()` twice from the same seed and compares the
// JSON of what it returns. The check that lets a refactor be verified by diff.
export function replays(rng, seed, run) {
  rng.seed(seed);
  const a = JSON.stringify(run());
  rng.seed(seed);
  const b = JSON.stringify(run());
  return { same: a === b, a, b };
}

// Hedy's greedy buyer, generalized: repeatedly buys whichever option scores best
// (gain per cost) until nothing scores above zero. `options(state)` lists what can
// be bought now; `score(state, option)` rates one; `buy(state, option)` returns
// true if it went through.
export function greedy(state, { options, score, buy, max = 1000 }) {
  let bought = 0;
  while (bought < max) {
    let best = null;
    for (const o of options(state)) {
      const s = score(state, o);
      if (s > 0 && (!best || s > best.s)) best = { o, s };
    }
    if (!best || !buy(state, best.o)) break;
    bought++;
  }
  return bought;
}

// m:ss for pacing printouts.
export const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
