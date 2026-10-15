// Guild Rising's tests, on plain node: `npm test`. The game logic still lives inside
// App.jsx, so these cover what moved onto the studio kit: the guide, the save and
// the run analytics.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const { suite, test, ok, eq, deepEq, report } = await import("../src/kit/test/harness.js");
const { createTutorial, checkSteps } = await import("../src/kit/index.js");
const { TUTORIAL_STEPS, TUT_KEY, TUT_VERSION } = await import("../src/tutorial.js");
const { SAVE_KEY, createSave, createStats, startRun } = await import("../src/studio.js");

const game = (over = {}) => ({
  coins: 0, freedHours: 0, phase: "survival", built: {}, members: [{ name: "You" }], firstVoteHeld: false,
  activeVote: null, activePolicyVote: null, neighborEvent: null, crisisWarning: null, transitionModal: null,
  anyReady: false, modalOpen: false, ...over,
});

suite("guide", () => {
  test("keeps to the studio's goal-first rule", () => deepEq(checkSteps(TUTORIAL_STEPS), []));
  test("every step has a unique id, a title and a body", () => {
    eq(new Set(TUTORIAL_STEPS.map(s => s.id)).size, TUTORIAL_STEPS.length);
    ok(TUTORIAL_STEPS.every(s => s.title && s.body));
  });
  test("opens on the survival goal and doesn't pause the game", () => {
    store.clear();
    const t = createTutorial({ key: TUT_KEY, version: TUT_VERSION, steps: TUTORIAL_STEPS, autoStart: true });
    eq(t.observe(game())?.id, "survive");
    eq(t.paused(game()), false);
  });
  test("survival finishes however the buildings went up", () => {
    store.clear();
    const t = createTutorial({ key: TUT_KEY, version: TUT_VERSION, steps: TUTORIAL_STEPS, autoStart: true });
    t.observe(game());
    t.observe(game({ built: { garden: true, shelter: true } }));
    ok(t.seen.includes("survive"));
  });
  test("hints wait for a stall, vaguest first", () => {
    store.clear();
    let now = 0;
    const t = createTutorial({ key: TUT_KEY, version: TUT_VERSION, steps: TUTORIAL_STEPS, autoStart: true, clock: () => now });
    t.observe(game());
    eq(t.hint(game()), null);
    now = 25000; ok(/Pitch In/.test(t.hint(game()).body));
    now = 50000; ok(/Garden costs/.test(t.hint(game()).body));
  });
  test("a crisis warning pauses for a read, then the goal comes back", () => {
    store.clear();
    const t = createTutorial({ key: TUT_KEY, version: TUT_VERSION, steps: TUTORIAL_STEPS, autoStart: true, hidden: g => g.modalOpen });
    t.observe(game());
    const warned = game({ crisisWarning: { ticksLeft: 10 }, modalOpen: true });
    eq(t.observe(warned)?.id, "crisis");
    eq(t.paused(warned), true);
    t.next(warned);
    eq(t.observe(game())?.id, "survive");
  });
  test("the first vote shows before the build goal", () => {
    store.clear();
    const t = createTutorial({ key: TUT_KEY, version: TUT_VERSION, steps: TUTORIAL_STEPS, autoStart: true, initial: { seen: ["survive"] } });
    eq(t.observe(game({ phase: "start" }))?.id, "build");
    eq(t.observe(game({ phase: "start", activeVote: { playerVote: null } }))?.id, "vote");
    eq(t.observe(game({ phase: "start", activeVote: { playerVote: 1 } }))?.id, "build");
  });
  test("progress saved before the kit still loads", () => {
    store.clear();
    localStorage.setItem(TUT_KEY, JSON.stringify({ v: 1, status: "skipped", seen: ["pitch", "garden"] }));
    const t = createTutorial({ key: TUT_KEY, version: TUT_VERSION, steps: TUTORIAL_STEPS });
    eq(t.status, "skipped");
  });
});

suite("save", () => {
  test("a commons saved before the kit carries over", () => {
    store.clear();
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, savedAt: 5, coins: 42, phase: "grow" }));
    const s = createSave().load();
    eq(s.coins, 42);
    eq(s.phase, "grow");
  });
  test("round-trips through the kit's box", () => {
    store.clear();
    const save = createSave();
    ok(save.write({ coins: 7, run: "abc" }));
    eq(JSON.parse(localStorage.getItem(SAVE_KEY)).v, 1);
    eq(createSave().load().coins, 7);
  });
  test("an unreadable save starts a new commons", () => {
    store.clear();
    localStorage.setItem(SAVE_KEY, "{oops");
    eq(createSave().load(), null);
  });
});

suite("analytics", () => {
  const make = () => {
    const sent = [];
    const stats = createStats({ fetch: async (_u, o) => { sent.push(...JSON.parse(o.body).events); return { ok: true }; }, flushEvery: 0, navigator: {} });
    return { stats, sent };
  };
  test("a new game starts a run", async () => {
    store.clear();
    const { stats, sent } = make();
    ok(startRun(stats, null, {}));
    await stats.flush();
    deepEq(sent.map(e => [e.game, e.name]), [["guild-rising", "run_start"]]);
  });
  test("a saved game resumes its run", async () => {
    const { stats, sent } = make();
    eq(startRun(stats, { run: "r1" }, { t: 300 }), "r1");
    await stats.flush();
    eq(sent[0].name, "run_resume");
    eq(sent[0].run, "r1");
    eq(sent[0].t, 300);
  });
  test("a lost or won commons doesn't start a run on reload", () => {
    const { stats } = make();
    eq(startRun(stats, { defeat: { year: 2 } }, {}), null);
    eq(startRun(stats, { victoryShown: true }, {}), null);
    // saved in the instant between the win and its run end: still no second win
    eq(startRun(stats, { victoryShown: true, run: "r1" }, {}), null);
  });
  test("a save from before analytics gets a new run", async () => {
    const { stats, sent } = make();
    ok(startRun(stats, { coins: 5 }, { t: 0 }));
    await stats.flush();
    eq(sent[0].props.from_save, true);
  });
  test("a win ends the run", async () => {
    const { stats, sent } = make();
    startRun(stats, null, {});
    stats.runEnd("win", { path: "spread" });
    await stats.flush();
    deepEq(sent.at(-1).props, { outcome: "win", path: "spread" });
    eq(stats.run, null);
  });
});

await report();
