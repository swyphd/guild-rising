// Guild Rising's pieces of the studio kit (src/kit, copied from swyphd/permadeath-media
// with `node ../permadeath-media/kit/sync.mjs src/kit`): the browser save and play
// analytics. Plain JS so tests can run it on node.
import { createLocalSave, createAnalytics } from "./kit/index.js";

export const BUILD = "v17";
export const GAME = "guild-rising";

// ── SAVE ─────────────────────────────────────────────────────────────────────
// The key and shape are the ones the game used before the kit, so existing commons
// survive. A save from before the kit is a bare state ({ v:1, savedAt, ...state }),
// which the kit hands to `migrate` as version 0.
export const SAVE_KEY = "guild-rising-save";
export const SAVE_VERSION = 1;
export const migrateSave = (data, from) => (from === 0 && data && typeof data === "object" && data.v === 1 ? data : null);
export const createSave = () => createLocalSave({ key: SAVE_KEY, version: SAVE_VERSION, migrate: migrateSave });

// ── MAILING LIST ─────────────────────────────────────────────────────────────
export const SIGNUP = { source: GAME, doneKey: "guild-rising-newsletter" };

// ── ANALYTICS ────────────────────────────────────────────────────────────────
// Runs, milestones and choices go to the site's /api/events (game_events table).
// `t` is seconds of play: ticks that ran, so time paused on a modal or the guide
// doesn't count.
export const createStats = (opts = {}) => createAnalytics({ game: GAME, version: BUILD, ...opts });

// Resumes the saved run, or starts one. A finished run (won or lost) that's still on
// screen starts nothing; a save from before analytics gets a fresh run id.
export function startRun(stats, saved, where) {
  if (!saved) return stats.runStart({ t: 0 });
  if (saved.defeat) return null;
  if (saved.victoryShown) return null;
  if (saved.run) return stats.runStart(where, { resume: saved.run });
  return stats.runStart({ ...where, from_save: true });
}
