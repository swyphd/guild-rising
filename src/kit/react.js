// Copied from swyphd/permadeath-media kit/ at a8cfaa0. Edit it there, then re-run kit/sync.mjs.
// React glue for the kit, for games built with a bundler (Vite, esbuild). The other
// kit modules have no dependencies and run straight from /kit/ in a plain page; this
// one imports 'react', so it only works where a bundler resolves that.
import { useEffect, useMemo, useState } from 'react';
import { createNewsletter } from './newsletter.js';

// Re-renders when a tutorial (createTutorial) or a cloud save (createCloudSave) changes.
export function useKit(thing) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!thing) return undefined;
    const off = (thing.subscribe || thing.on)(() => tick((n) => n + 1));
    return off;
  }, [thing]);
  return thing;
}

// The step to show for this render, with the tutorial moved along to match the game.
// `game` is the snapshot the steps read.
export function useTutorialStep(tutorial, game) {
  useKit(tutorial);
  return tutorial.observe(game);
}

// State for a signup form: { email, setEmail, status, error, listed, submit(e, extra) }.
// status: 'idle' | 'busy' | 'done' | 'error'. `extra` is { website } from a honeypot.
export function useSignup({ source, tag, doneKey } = {}) {
  const list = useMemo(() => createNewsletter({ source, doneKey }), [source, doneKey]);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState(() => (list.listed() ? 'done' : 'idle'));
  const [error, setError] = useState('');
  const submit = async (e, extra = {}) => {
    e?.preventDefault?.();
    setStatus('busy');
    setError('');
    try { await list.subscribe(email, { tag, ...extra }); setStatus('done'); }
    catch (err) { setError(err.message); setStatus('error'); }
  };
  return { email, setEmail, status, error, listed: list.listed(), submit };
}
