import { useState, useEffect, useRef } from "react";

// ── TUTORIAL ─────────────────────────────────────────────────────────────────
// A guide that introduces each mechanic the first time it matters. Progress lives
// in localStorage so a returning player only sees what they haven't seen yet, and
// skipping turns it off for good (the ❓ guide can replay it).
const TUT_KEY = "guild-rising-tutorial";
const TUT_VERSION = 1;

const loadTut = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(TUT_KEY) || "null");
    if (raw && raw.v === TUT_VERSION && Array.isArray(raw.seen)) return raw;
  } catch (e) {}
  return { v: TUT_VERSION, status: "new", seen: [] };
};
const saveTut = t => { try { localStorage.setItem(TUT_KEY, JSON.stringify(t)); } catch (e) {} };

const onPage = g => !g.modalOpen;

// Order matters: the first unseen step whose `when` holds is shown.
// `done` marks an action step: it waits for the player to do the thing, without pausing.
// Steps without `done` are read steps: the game pauses until "Got it".
export const TUTORIAL_STEPS = [
  { id:"pitch", target:"resources", title:"Fill the treasury",
    when:g=>onPage(g)&&g.phase==="survival"&&!g.built.garden,
    done:g=>g.coins>=20,
    body:"Your commons starts with just you. Tap 🤝 Pitch In to add coins to the Treasury. Save 20 coins for your first building.\n\n💜 Free Up adds Free Time (⏳). You'll spend it later on speeches and festivals." },
  { id:"garden", target:"survival", title:"Build the Commons Garden",
    when:g=>onPage(g)&&g.phase==="survival"&&!g.built.garden&&g.coins>=20,
    done:g=>!!g.built.garden,
    body:"Buy the Commons Garden for 🪙 20. Buildings earn coins every second, so the treasury starts filling on its own." },
  { id:"shelter", target:"survival", title:"Raise a shelter",
    when:g=>onPage(g)&&g.phase==="survival"&&g.built.garden&&!g.built.shelter,
    done:g=>!!g.built.shelter,
    body:"Next, the Common Shelter for 🪙 90. People can only join the commons if there are beds for them, so housing comes before growth. Keep pitching in while the garden earns." },
  { id:"goal", target:"goal", title:"Goals unlock the game",
    when:g=>onPage(g)&&g.phase!=="survival",
    body:"You survived the winter. This card always shows your current goal. Each one opens up more of the game: start the commons, hold your first vote, grow strong, then stand up to the Kingdom." },
  { id:"assembly", target:"assembly", title:"The Assembly decides",
    when:g=>onPage(g)&&g.phase!=="survival",
    body:"From now on you don't build alone. The commons votes on what to build.\n\n📋 Nominate puts a building of your choice on the ballot. 🗳️ Call a Vote opens the assembly now, or wait and one is called for you.\n\nThe winner joins the Priority Queue, and 20% of all income goes toward finishing it. The other 80% stays in your Treasury." },
  { id:"tree", target:"tree", title:"The skill tree",
    when:g=>onPage(g)&&g.phase!=="survival",
    body:"Five branches: Commons, Agrarian, Craft, Defense and Knowledge. Each branch is built in order, top to bottom.\n\nA finished building brings in a new member who shares its path, if there's a free bed. Buildings also earn more when members share their affinity." },
  { id:"vote", target:"assembly", title:"Cast your vote",
    when:g=>onPage(g)&&!!g.activeVote&&g.activeVote.playerVote===null,
    done:g=>!g.activeVote||g.activeVote.playerVote!==null,
    body:"The assembly is open. Pick a proposal with \"Vote for this\". Your voice is one among many: members vote for what matches their skills.\n\nLosing? A 🗣️ Speech costs ⏳ 8 Free Time and may win over up to two members." },
  { id:"scores", target:"scores", title:"Commons scores",
    when:g=>onPage(g)&&g.phase!=="survival"&&g.firstVoteHeld,
    body:"Food, Infra, Defense and Knowledge measure your strength. They come from members' affinities and from buildings. The \"need\" number under each is the crisis threshold, and it rises as the commons grows.\n\n💚 Wellbeing slowly drifts down. When it falls, income drops and you resist crises worse." },
  { id:"season", target:"season", title:"Seasons and assembly slots",
    when:g=>onPage(g)&&g.phase!=="survival"&&g.firstVoteHeld,
    body:"A season lasts about five minutes. Each one allows only a few assembly slots, and every build vote uses one. Crises can take one too.\n\nSpring and summer are generous. Winter has a single slot, no policy votes and lower income, so plan ahead." },
  { id:"members", target:"members", title:"Members and affinities",
    when:g=>onPage(g)&&g.phase!=="survival"&&g.members.length>=2,
    body:"Each member has affinities (🌾 Agrarian, 🔨 Craft, ⚔️ Defense, 📚 Knowledge, 🐑 Stewardship). They earn XP while the commons has buildings on their paths.\n\nWhen someone is ready, Support them (🪙 500) to learn a new affinity. Study speeds up their XP, and Reskill swaps an affinity." },
  { id:"projects", target:"projects", title:"Spend free time together",
    when:g=>onPage(g)&&g.phase!=="survival"&&g.freedHours>=20,
    body:"Free Time (⏳) pays for collective projects.\n\n🎶 Festival: big wellbeing boost and Solidarity (faster XP for a while).\n📚 Teach-In: XP for everyone, most for those furthest behind.\n🤝 Caravan: opens in the final phase and is one of the ways to win." },
  { id:"ready", target:"members", title:"A member is ready to grow",
    when:g=>onPage(g)&&g.phase!=="survival"&&g.anyReady,
    body:"Someone has enough XP to learn a new affinity. Tap Support on their card (🪙 500). More affinities raise your scores, which is how the commons turns crises aside." },
  { id:"policy", target:"assembly", title:"Rewriting the Charter",
    when:g=>onPage(g)&&!!g.activePolicyVote&&g.activePolicyVote.playerVote===null,
    done:g=>!g.activePolicyVote||g.activePolicyVote.playerVote!==null,
    body:"Policy votes change the Charter: how much income goes to the Priority Queue, who can join, how you treat neighbors. The new rule holds until it's voted on again. Cast your vote." },
  { id:"neighbor", pos:"top", title:"Neighbors in need",
    when:g=>!!g.neighborEvent,
    body:"People from nearby ask for help. Welcoming them adds members right away, even beyond your beds, and lifts wellbeing. Turning them away keeps the commons small and can cost coins." },
  { id:"crisis", pos:"top", title:"The Kingdom moves against you",
    when:g=>!!g.crisisWarning,
    body:"When the countdown ends, the crisis tests one score against the threshold:\n👑 Tax → 📚 Knowledge\n⚔️ Conscription → ⚔️ Defense\n☀️ Drought → 🌾 Food\n\nMeet the threshold and it passes. Reach half and the damage is reduced. Until then you can buy an Emergency Build with treasury coins to help." },
  { id:"transition", pos:"top", title:"A new season",
    when:g=>!!g.transitionModal,
    body:"Between seasons the game pauses, and the commons votes on how to face what's next. Read the forecast, cast your vote, then begin the season." },
  { id:"pressure", target:"goal", title:"Free the commons",
    when:g=>onPage(g)&&g.phase==="pressure",
    body:"The Kingdom has noticed you, and crises now arrive faster. There are two ways to win:\n\n✊ Endure: finish the whole skill tree, then weather 3 crises.\n🤝 Spread: send 3 mutual-aid caravans to seed sister commons.\n\nThat's everything. The commons is yours." },
];

const C = { gold:"#f0c060", tan:"#c9a870", dim:"#7a5a30", text:"#f0e0c0", border:"#5a3a1a" };
const btn = { background:"linear-gradient(180deg,#4a3010,#2d1a05)", border:`2px solid ${C.gold}`, borderRadius:8, color:C.gold, fontSize:13, padding:"9px 14px", cursor:"pointer", fontFamily:"inherit" };
const linkBtn = { background:"none", border:"none", color:C.dim, fontSize:11, cursor:"pointer", textDecoration:"underline", padding:4, fontFamily:"inherit" };
const overlay = { position:"fixed", inset:0, background:"#000000cc", display:"flex", alignItems:"center", justifyContent:"center", zIndex:160, padding:16 };
const box = { background:"linear-gradient(160deg,#2d1a0e,#1a0d05)", border:`2px solid ${C.gold}`, borderRadius:12, padding:22, maxWidth:440, width:"100%", maxHeight:"88vh", overflowY:"auto", fontFamily:"Georgia,serif", color:C.text, boxSizing:"border-box" };
const para = { fontSize:13, lineHeight:1.6, whiteSpace:"pre-line", margin:0 };

export const TUTORIAL_CSS = `.tut-hl{box-shadow:0 0 0 3px #f0c060,0 0 22px 6px #f0c06070!important;transition:box-shadow .3s}`;

// game: a snapshot of the state the steps read. pausedRef: the tick skips while it's true.
export default function Tutorial({ game, pausedRef, helpOpen, setHelpOpen }) {
  const [tut, setTut] = useState(loadTut);
  const shownRef = useRef(null);

  const update = fn => setTut(t => { const n = fn(t); saveTut(n); return n; });
  const markSeen = id => update(t => t.seen.includes(id) ? t : { ...t, seen: [...t.seen, id] });

  const active = tut.status === "active";
  const step = active ? TUTORIAL_STEPS.find(s => !tut.seen.includes(s.id) && s.when(game)) : null;

  // An action step finishes when the player does it, or is retired once it stops
  // applying (the vote closed without them) so it never shows stale. Read steps
  // wait for "Got it" and come back if a modal hid them.
  const prev = shownRef.current;
  useEffect(() => {
    if (prev && prev !== step?.id) {
      const s = TUTORIAL_STEPS.find(x => x.id === prev);
      if (s?.done && !tut.seen.includes(s.id) && (s.done(game) || (!s.when(game) && !game.modalOpen))) markSeen(s.id);
    }
    if (step?.done && step.done(game)) markSeen(step.id);
    shownRef.current = step?.id || null;
  });

  // Every step seen: the tutorial is finished.
  useEffect(() => {
    if (active && TUTORIAL_STEPS.every(s => tut.seen.includes(s.id))) update(t => ({ ...t, status: "done" }));
  }, [active, tut.seen]);

  const welcome = tut.status === "new";
  const readStep = step && !step.done;
  pausedRef.current = welcome || helpOpen || !!readStep;

  // Spotlight the section the step talks about.
  const target = step?.target;
  useEffect(() => {
    if (!target) return;
    const el = document.querySelector(`[data-tut="${target}"]`);
    if (!el) return;
    el.classList.add("tut-hl");
    // Put the section's top near the top of the screen so the guide card below covers as little as possible.
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 12), behavior: "smooth" });
    return () => el.classList.remove("tut-hl");
  }, [target, step?.id]);

  const skip = () => update(t => ({ ...t, status: "skipped" }));
  const start = () => update(t => ({ ...t, status: "active" }));
  const replay = () => { update(() => ({ v: TUT_VERSION, status: "active", seen: [] })); setHelpOpen(false); };

  return (
    <>
      {welcome && (
        <div style={overlay} role="dialog" aria-modal="true" aria-labelledby="tut-welcome-title">
          <div style={box}>
            <div style={{ textAlign:"center", fontSize:32, marginBottom:4 }}>⚔️</div>
            <div id="tut-welcome-title" style={{ fontSize:20, fontWeight:"bold", color:C.gold, textAlign:"center", marginBottom:12 }}>Welcome to Guild Rising</div>
            <p style={{ ...para, marginBottom:10 }}>You've founded a commons in a kingdom that would rather you didn't exist.</p>
            <p style={{ ...para, marginBottom:10 }}>Grow it together: earn coins, raise buildings, take in members, and decide what comes next by vote. Then hold out against the taxes, soldiers and droughts the Crown sends your way.</p>
            <p style={{ ...para, marginBottom:16, color:C.tan }}>The guide introduces each part of the game as it opens up. The game waits while you read.</p>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <button style={{ ...btn, fontWeight:"bold" }} onClick={start} autoFocus>Show me how</button>
              <button style={{ ...btn, borderColor:C.border, color:C.tan }} onClick={skip}>I know the ropes, skip it</button>
            </div>
            <div style={{ fontSize:11, color:C.dim, textAlign:"center", marginTop:12 }}>You can reopen the guide anytime with ❓ at the top.</div>
          </div>
        </div>
      )}

      {step && !welcome && !helpOpen && (
        <div role="dialog" aria-live="polite" aria-labelledby="tut-step-title" style={{
          position:"fixed", left:12, right:12, [step.pos === "top" ? "top" : "bottom"]:12, zIndex:150,
          margin:"0 auto", maxWidth:440, maxHeight:"45vh", overflowY:"auto", boxSizing:"border-box",
          background:"linear-gradient(160deg,#3a2210f5,#1f1006f5)", border:`2px solid ${C.gold}`, borderRadius:12,
          padding:"12px 14px", boxShadow:"0 6px 24px #000c", fontFamily:"Georgia,serif", color:C.text }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
            <span style={{ fontSize:10, letterSpacing:2, color:C.dim, textTransform:"uppercase" }}>📜 Guide</span>
            <span style={{ flex:1 }} />
            {readStep && <span style={{ fontSize:10, color:C.tan }}>⏸ Paused</span>}
          </div>
          <div id="tut-step-title" style={{ fontSize:15, fontWeight:"bold", color:C.gold, marginBottom:6 }}>{step.title}</div>
          <p style={para}>{step.body}</p>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10 }}>
            <button style={linkBtn} onClick={skip}>Skip tutorial</button>
            <span style={{ flex:1 }} />
            {step.done
              ? <span style={{ fontSize:11, color:C.tan, fontStyle:"italic" }}>Do this to continue · <button style={{ ...linkBtn, padding:0 }} onClick={() => markSeen(step.id)}>dismiss</button></span>
              : <button style={{ ...btn, padding:"7px 16px" }} onClick={() => markSeen(step.id)}>Got it</button>}
          </div>
        </div>
      )}
      {/* Room to scroll the last sections above the guide card. */}
      {step && !welcome && !helpOpen && step.pos !== "top" && <div style={{ height:"40vh" }} />}

      {helpOpen && (
        <div style={overlay} role="dialog" aria-modal="true" aria-labelledby="tut-help-title" onClick={e => e.target === e.currentTarget && setHelpOpen(false)}>
          <div style={box}>
            <div id="tut-help-title" style={{ fontSize:18, fontWeight:"bold", color:C.gold, textAlign:"center", marginBottom:4 }}>❓ How to Play</div>
            <div style={{ fontSize:11, color:C.dim, textAlign:"center", marginBottom:14 }}>The game is paused while this is open.</div>
            {TUTORIAL_STEPS.map(s => (
              <div key={s.id} style={{ borderTop:`1px solid ${C.border}`, padding:"10px 0" }}>
                <div style={{ fontSize:13, fontWeight:"bold", color:C.gold, marginBottom:4 }}>{s.title}</div>
                <p style={{ ...para, fontSize:12, color:C.tan }}>{s.body}</p>
              </div>
            ))}
            <div style={{ display:"flex", gap:8, marginTop:12 }}>
              <button style={{ ...btn, flex:1, borderColor:C.border, color:C.tan }} onClick={replay}>Replay tutorial</button>
              <button style={{ ...btn, flex:1 }} onClick={() => setHelpOpen(false)} autoFocus>Back to the commons</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
