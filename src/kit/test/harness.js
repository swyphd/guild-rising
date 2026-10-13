// Copied from swyphd/permadeath-media kit/ at a8cfaa0. Edit it there, then re-run kit/sync.mjs.
// A minimal headless test harness, from Hedy Plant's tests/harness.mjs: suites,
// tests, a summary, a non-zero exit code on failure. No dependencies, runs on plain
// `node`. Tests may be async: they still run one at a time, in order (a test that
// starts while an async one is pending waits its turn), so tests can share globals
// such as a fake localStorage. Call `await report()` last.
//
//   import { suite, test, ok, eq, near, report } from '<kit>/test/harness.js';
//   suite('engine', () => { test('starts empty', () => eq(createState().cars, 0)); });
//   await report();

const results = { pass: 0, fail: 0, failures: [] };
let tail = null; // the last queued piece of work, once any test has gone async
let current = '';

// Runs now while everything so far was synchronous; after the first async test,
// queues behind whatever is pending.
function inOrder(fn) {
  if (tail) { tail = tail.then(fn); return tail; }
  const out = fn();
  if (out && typeof out.then === 'function') tail = out;
  return out;
}

export function suite(name, fn) {
  current = name;
  inOrder(() => console.log(`\n${name}`));
  return fn();
}

function settle(name, suiteName, run) {
  const pass = () => { results.pass++; console.log(`  ✓ ${name}`); };
  const fail = (e) => {
    results.fail++;
    results.failures.push(`${suiteName} › ${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}\n      ${e?.message ?? e}`);
  };
  try {
    const out = run();
    if (out && typeof out.then === 'function') return out.then(pass, fail);
    pass();
  } catch (e) { fail(e); }
  return undefined;
}

export function test(name, fn) {
  const suiteName = current;
  return inOrder(() => settle(name, suiteName, fn));
}

export function ok(v, msg = 'expected truthy') {
  if (!v) throw new Error(msg);
}
export function eq(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
export function deepEq(a, b, msg) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(msg || `expected ${jb}, got ${ja}`);
}
export function near(a, b, tol) {
  if (Math.abs(a - b) > tol) throw new Error(`expected ${b} ± ${tol}, got ${a}`);
}
export async function rejects(promise, match) {
  try { await promise; } catch (e) {
    if (match && !String(e?.message ?? e).match(match)) throw new Error(`rejected with "${e?.message}", expected ${match}`);
    return e;
  }
  throw new Error('expected a rejection');
}

export async function report() {
  for (let t = null; t !== tail;) { t = tail; await t; }
  console.log(`\n${results.pass} passed, ${results.fail} failed`);
  if (results.fail) {
    for (const f of results.failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
  return { ...results };
}
