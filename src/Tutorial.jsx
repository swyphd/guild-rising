import { useState, useEffect } from "react";
import { createTutorial } from "./kit/index.js";
import { useTutorialStep } from "./kit/react.js";
import { TUTORIAL_STEPS, TUT_KEY, TUT_VERSION } from "./tutorial.js";

// ── TUTORIAL ─────────────────────────────────────────────────────────────────
// Draws the guide in Guild Rising's look. The studio kit's engine picks the step
// (see tutorial.js for the steps and why they're goals) and keeps progress in
// localStorage, so a returning player only sees what they haven't seen yet and
// skipping turns it off for good (the ❓ guide can replay it).
export { TUTORIAL_STEPS };

const C = { gold:"#f0c060", tan:"#c9a870", dim:"#7a5a30", text:"#f0e0c0", border:"#5a3a1a" };
const btn = { background:"linear-gradient(180deg,#4a3010,#2d1a05)", border:`2px solid ${C.gold}`, borderRadius:8, color:C.gold, fontSize:13, padding:"9px 14px", cursor:"pointer", fontFamily:"inherit" };
const linkBtn = { background:"none", border:"none", color:C.dim, fontSize:11, cursor:"pointer", textDecoration:"underline", padding:4, fontFamily:"inherit" };
const overlay = { position:"fixed", inset:0, background:"#000000cc", display:"flex", alignItems:"center", justifyContent:"center", zIndex:160, padding:16 };
const box = { background:"linear-gradient(160deg,#2d1a0e,#1a0d05)", border:`2px solid ${C.gold}`, borderRadius:12, padding:22, maxWidth:440, width:"100%", maxHeight:"88vh", overflowY:"auto", fontFamily:"Georgia,serif", color:C.text, boxSizing:"border-box" };
const para = { fontSize:13, lineHeight:1.6, whiteSpace:"pre-line", margin:0 };

export const TUTORIAL_CSS = `.tut-hl{box-shadow:0 0 0 3px #f0c060,0 0 22px 6px #f0c06070!important;transition:box-shadow .3s}`;

// game: a snapshot of the state the steps read. pausedRef: the tick skips while it's true.
// game: a snapshot of the state the steps read. pausedRef: the tick skips while it's true.
export default function Tutorial({ game, pausedRef, helpOpen, setHelpOpen }) {
  const [tutorial] = useState(() => createTutorial({ key: TUT_KEY, version: TUT_VERSION, steps: TUTORIAL_STEPS, hidden: g => g.modalOpen }));
  const step = useTutorialStep(tutorial, game);
  const hint = step ? tutorial.hint(game) : null;

  const welcome = tutorial.status === "new";
  const readStep = step && !step.goal;
  pausedRef.current = welcome || helpOpen || tutorial.paused(game);

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

  const skip = () => tutorial.skip();
  const start = () => tutorial.start();
  const replay = () => { tutorial.replay(); setHelpOpen(false); };

  return (
    <>
      {welcome && (
        <div style={overlay} role="dialog" aria-modal="true" aria-labelledby="tut-welcome-title">
          <div style={box}>
            <div style={{ textAlign:"center", fontSize:32, marginBottom:4 }}>⚔️</div>
            <div id="tut-welcome-title" style={{ fontSize:20, fontWeight:"bold", color:C.gold, textAlign:"center", marginBottom:12 }}>Welcome to Guild Rising</div>
            <p style={{ ...para, marginBottom:10 }}>You've founded a commons in a kingdom that would rather you didn't exist.</p>
            <p style={{ ...para, marginBottom:10 }}>Grow it together: earn coins, raise buildings, take in members, and decide what comes next by vote. Then hold out against the taxes, soldiers and droughts the Crown sends your way.</p>
            <p style={{ ...para, marginBottom:16, color:C.tan }}>The guide sets you a goal as each part of the game opens up, and leaves the route to you. If you get stuck, it drops a hint.</p>
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
          {hint && <p style={{ ...para, marginTop:8, color:C.tan, fontStyle:"italic" }}>💡 {hint.body}</p>}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10 }}>
            <button style={linkBtn} onClick={skip}>Skip tutorial</button>
            <span style={{ flex:1 }} />
            {readStep
              ? <button style={{ ...btn, padding:"7px 16px" }} onClick={() => tutorial.next(game)}>Got it</button>
              : <span style={{ fontSize:11, color:C.tan, fontStyle:"italic" }}>Goal · <button style={{ ...linkBtn, padding:0 }} onClick={() => tutorial.markSeen(step.id)}>dismiss</button></span>}
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
