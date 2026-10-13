// Copied from swyphd/permadeath-media kit/ at a8cfaa0. Edit it there, then re-run kit/sync.mjs.
// Seeded randomness, from Union Up's engine/rng.js.
//
// A game draws every roll from one source instead of Math.random, so a run can be
// replayed: same seed, same plans, same game, which is how a refactor is checked
// (diff the sim's output) and how a daily puzzle or a shared game code deals the
// same cards to everyone.
//
//   const rng = createRng(7);   rng.random()  rng.int(6)  rng.pick(list)  rng.shuffle(list)
//
// Unseeded (`createRng()` or `createRng(null)`) it is Math.random, which is what
// a shipped game usually wants. `rng.seed(n)` reseeds in place, so modules that
// imported the same instance all switch together (Union Up's `seedRng`).
// `rng.state()` / `rng.restore(s)` let a save carry the generator mid-run.

export function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Strings make good seeds too ("2026-10-13" for a daily, a game code for a table).
export function hashSeed(seed) {
  if (typeof seed === 'number') return seed >>> 0;
  const s = String(seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function createRng(seed = null) {
  const unseeded = () => Math.random();
  let source = unseeded;
  let a = null; // mulberry32's state while seeded, so it can be saved and restored

  const rng = {
    seed(next) {
      if (next == null || next === '') { source = unseeded; a = null; return rng; }
      a = hashSeed(next);
      source = () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      return rng;
    },
    seeded: () => a != null,
    state: () => a,
    restore(state) { if (state == null) return rng.seed(null); rng.seed(0); a = state | 0; return rng; },
    random: () => source(),
    // integer in [0, n)
    int: (n) => Math.floor(source() * n),
    // integer in [lo, hi], both ends included
    range: (lo, hi) => lo + Math.floor(source() * (hi - lo + 1)),
    chance: (p) => source() < p,
    pick: (list) => list[Math.floor(source() * list.length)],
    // a new shuffled copy (Fisher-Yates); the input is left alone
    shuffle(list) {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(source() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    // pick by weight: weighted([['a', 3], ['b', 1]]) is 'a' three times in four
    weighted(pairs) {
      const total = pairs.reduce((n, [, w]) => n + w, 0);
      let r = source() * total;
      for (const [v, w] of pairs) { if ((r -= w) < 0) return v; }
      return pairs[pairs.length - 1][0];
    },
  };
  return rng.seed(seed);
}

export const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
