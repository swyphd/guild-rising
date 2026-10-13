// The guide's steps: plain data, so tests can check them without a browser. The studio
// kit's tutorial engine (kit/tutorial.js) decides which one shows; Tutorial.jsx draws it.
//
// The guide gives the player a goal and lets them work out the route, the way a game says
// "here's how to walk, now leave the room". Two kinds of step:
//   goal steps (`goal`): a target, not a recipe. The game keeps running and the card stays
//     until the player gets there their own way. `hints` come in only if they stall.
//   read steps (no `goal`): explain something that just happened to the commons (a crisis,
//     a new season). The game pauses until "Got it". Kept few and short.
// Order matters: the first unseen step whose `when` holds is shown.
// `when` and `goal` get the snapshot App.jsx passes in (coins, phase, built, votes, ...).

export const TUT_KEY = "guild-rising-tutorial";
export const TUT_VERSION = 1; // the stored shape { v, status, seen } is the kit's, so old progress loads as-is

const onPage = g => !g.modalOpen;
const pastSurvival = g => g.phase !== "survival";

export const TUTORIAL_STEPS = [
  { id:"survive", title:"Survive the winter",
    when:g=>onPage(g)&&g.phase==="survival",
    goal:g=>!!(g.built.garden&&g.built.shelter),
    body:"Your commons is just you, and winter is coming. Raise the Commons Garden and the Common Shelter before it does. Everything on this page is yours to try.",
    hints:[
      { after:20, body:"🤝 Pitch In adds coins to the Treasury." },
      { after:45, body:"The Garden costs 🪙 20 and earns every second once it stands. Build it first, then save for the Shelter." },
    ] },
  { id:"vote", target:"assembly", title:"Cast your vote",
    when:g=>onPage(g)&&!!g.activeVote&&g.activeVote.playerVote===null,
    goal:g=>!g.activeVote||g.activeVote.playerVote!==null,
    body:"The assembly is open. Your voice is one among many: members vote for what matches their skills.",
    hints:[{ after:15, body:"Losing? A 🗣️ Speech costs ⏳ 8 Free Time and may win over two members." }] },
  { id:"build", title:"Decide together",
    when:g=>onPage(g)&&g.phase==="start",
    goal:g=>pastSurvival(g)&&g.phase!=="start",
    body:"You made it. From here the commons builds what it votes for. Get two more buildings standing. The card at the top always shows your current goal.",
    hints:[
      { after:30, body:"🗳️ Call a Vote opens the assembly. 📋 Nominate puts a building of your choice on the ballot." },
      { after:75, body:"A winning proposal joins the Priority Queue. A share of all income funds the one at the top, and you can push coins in yourself." },
    ] },
  { id:"crisis", pos:"top", title:"The Kingdom moves against you",
    when:g=>!!g.crisisWarning,
    body:"When the countdown ends, the crisis tests one score:\n👑 Tax → 📚 Knowledge\n⚔️ Conscription → ⚔️ Defense\n☀️ Drought → 🌾 Food\n\nMeet the need and it passes; reach half and the damage shrinks. An Emergency Build can help in time." },
  { id:"grow", target:"goal", title:"Grow stronger",
    when:g=>onPage(g)&&g.phase==="grow",
    goal:g=>g.phase==="pressure",
    body:"Grow to 10 members with every score at or above its need. How you get there is up to the commons.",
    hints:[
      { after:60, body:"Scores come from members' affinities and from buildings. A new member joins when a building on their path finishes and there's a free bed." },
      { after:150, body:"Short of beds? The Commons branch has bigger shelters. Short on a score? Support or Study a member toward it." },
    ] },
  { id:"neighbor", pos:"top", title:"Neighbors in need",
    when:g=>!!g.neighborEvent,
    body:"People from nearby ask for help. Welcoming them adds members right away, even beyond your beds, and lifts wellbeing. Turning them away keeps the commons small." },
  { id:"ready", target:"members", title:"A member is ready to grow",
    when:g=>onPage(g)&&pastSurvival(g)&&g.anyReady,
    goal:g=>!g.anyReady,
    body:"Someone has enough XP to learn a new affinity. More affinities raise your scores, which is how the commons turns crises aside.",
    hints:[{ after:20, body:"Tap Support on their card (🪙 500)." }] },
  { id:"policy", target:"assembly", title:"Rewriting the Charter",
    when:g=>onPage(g)&&!!g.activePolicyVote&&g.activePolicyVote.playerVote===null,
    goal:g=>!g.activePolicyVote||g.activePolicyVote.playerVote!==null,
    body:"Policy votes change the Charter: how much income funds the queue, who can join, how you treat neighbors. The winner holds until it's voted on again." },
  { id:"transition", pos:"top", title:"A new season",
    when:g=>!!g.transitionModal,
    body:"Each season allows only a few assembly votes. Spring and summer are generous; winter has one, no policy votes and lower income. The game waits while the commons decides how to face what's next." },
  { id:"projects", target:"projects", title:"Free time is for spending",
    when:g=>onPage(g)&&pastSurvival(g)&&g.freedHours>=20,
    body:"Wellbeing drifts down, and income falls with it. ⏳ Free Time pays for what lifts it: a 🎶 Festival cheers everyone and speeds learning, a 📚 Teach-In helps those furthest behind." },
  { id:"pressure", target:"goal", title:"Free the commons",
    when:g=>onPage(g)&&g.phase==="pressure",
    body:"The Kingdom has noticed you, and crises come faster. Win one of two ways:\n✊ Endure: finish the whole tree, then weather 3 crises.\n🤝 Spread: send 3 mutual-aid caravans.\n\nIf wellbeing sits at zero too long, the commons dissolves. It's yours now." },
];
