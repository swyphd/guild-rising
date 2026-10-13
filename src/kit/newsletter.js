// Copied from swyphd/permadeath-media kit/ at a8cfaa0. Edit it there, then re-run kit/sync.mjs.
// The Permadeath Media mailing list, as every page's footer form already does it.
//
// The address goes to the site's /api/subscribe (Buttondown, tagged with the game,
// plus a Supabase backup row; see api/subscribe.js). `source` must be one of the
// SOURCES there and `tag` one of its TAGS, or the endpoint files it as 'unknown'
// / drops the tag, so add a new game's names to api/subscribe.js first.
//
// Brand rules: no pre-ticked boxes, no pop-ups on load, never block play on it.
import { SIGNUP_URL } from './config.js';

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
export const validEmail = (email) => EMAIL_RE.test(normalizeEmail(email));

const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

// Remembers that this browser is on the list, so a game stops asking.
// `doneKey` defaults to `${source}-newsletter`; pass the game's existing key
// (Card Check's 'cc-newsletter', Hedy's 'hp-newsletter') when adopting the kit.
export function createNewsletter({ source, doneKey = `${source}-newsletter`, url = SIGNUP_URL, fetch: fetchImpl } = {}) {
  if (!source) throw new Error('createNewsletter needs a source');
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));

  const listedAs = () => { try { return storage()?.getItem(doneKey) || null; } catch { return null; } };

  // Resolves once the address is on the list; rejects with a message a player can read.
  // `website` is the honeypot field's value: a bot filled it, so say yes and do nothing.
  async function subscribe(email, { tag, website } = {}) {
    const addr = normalizeEmail(email);
    if (!EMAIL_RE.test(addr)) throw new Error('That doesn’t look like an email address.');
    if (website) return addr;
    let res;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tag ? { email: addr, source, tag } : { email: addr, source }),
      });
    } catch {
      throw new Error('Something went wrong. Try again in a minute.');
    }
    if (!res.ok) throw new Error('Something went wrong. Try again in a minute.');
    try { storage()?.setItem(doneKey, addr); } catch {}
    return addr;
  }

  return { source, doneKey, listed: () => !!listedAs(), listedAs, subscribe };
}

// Wires up a form already in the page, the markup every page uses:
//   <form id="signup-form" novalidate>
//     <input id="signup-email" name="email" type="email">
//     <input name="website" type="text" tabindex="-1" autocomplete="off" class="hp">  (hidden honeypot)
//     <button type="submit">Join</button>
//     <p id="signup-msg" class="msg" role="status"></p>
//   </form>
// The message element gets class "msg ok" or "msg err". Returns a detach function.
export function mountSignupForm(form, { newsletter, source, tag, message, doneText } = {}) {
  const list = newsletter || createNewsletter({ source });
  const input = form.querySelector('input[type=email]');
  const btn = form.querySelector('button[type=submit], button');
  const msg = message || form.querySelector('[role=status], .msg');
  const say = (t, c) => { if (msg) { msg.textContent = t; msg.className = 'msg' + (c ? ' ' + c : ''); } };
  const done = (addr) => {
    say(doneText ? doneText(addr) : `You're on the list.${addr ? ` Updates go to ${addr}.` : ''}`, 'ok');
    input.disabled = true;
    if (btn) btn.disabled = true;
  };
  const prior = list.listedAs();
  if (prior) { input.value = prior; done(prior); }

  const onSubmit = async (e) => {
    e.preventDefault();
    const addr = normalizeEmail(input.value);
    if (!EMAIL_RE.test(addr)) { say('That doesn’t look like an email address.', 'err'); input.focus(); return; }
    if (btn) btn.disabled = true;
    say('Saving…');
    try {
      await list.subscribe(addr, { tag, website: form.elements?.website?.value });
      done(addr);
    } catch (err) {
      say(err.message, 'err');
      if (btn) btn.disabled = false;
    }
  };
  form.addEventListener('submit', onSubmit);
  return () => form.removeEventListener('submit', onSubmit);
}
