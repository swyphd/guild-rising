import { useState, useEffect, useRef, useMemo } from "react";

// ── CONSTANTS ────────────────────────────────────────────────────────────────
const TICK_MS            = 500;
const XP_PER_LEVEL       = [80, 180, 300];
const DEPTH_XP           = [120, 240, 400];
const VICTORY_CRISES     = 3;
const SISTER_VICTORY     = 3;
const SOLIDARITY_TICKS   = 180;
const SOLIDARITY_XP_MULT = 1.5;
const HOARD_DAMPEN       = 0.55;
const FESTIVAL_COST      = 20;
const TEACHIN_COST       = 35;
const CARAVAN_BASE       = 70;
const DEPTH_MULTS        = [1, 1.2, 1.4, 1.6];
const WELLBEING_START    = 70;
const WELLBEING_DRIFT    = 0.04;
const SPEECH_COST        = 8;
const VOTE_WINDOW_TICKS  = 40;
const PROPOSAL_COOLDOWN  = 300;
const POLICY_COOLDOWN    = 600;
const LEVEL_UP_COST      = 500;
const TRAIN_ADJ          = 400;
const TRAIN_DIST         = 1000;
const RETRAIN_ADJ        = 600;
const RETRAIN_DIST       = 1500;
const TIER_BONUS_MULT    = [0.6, 1, 1.6, 2.4, 3.2];
const QUEUE_ALLOC_FRAC   = 0.2;
const TREASURY_ALLOC_FRAC= 0.8;
const SEASON_LENGTH      = 600; // ticks per season (~5 min)

// ── SEASONS ──────────────────────────────────────────────────────────────────
const SEASONS = {
  spring: {
    label:"Spring", icon:"🌱", next:"summer",
    buildSlots:3, policyVote:true,
    incomeMult:1.10, freedMult:1.15, driftMult:0.80,
    crisisBias:null,
    forecast:"The soil warms. Growth is possible.",
    ambient:["starts turning the soil again.","says the seedlings are ahead of schedule.","fixes the fence before the lambs come.","checks on the new buds in the garden."],
  },
  summer: {
    label:"Summer", icon:"☀️", next:"autumn",
    buildSlots:3, policyVote:true,
    incomeMult:1.20, freedMult:1.00, driftMult:1.00,
    crisisBias:"conscription",
    forecast:"Trade is brisk. The Kingdom's soldiers are restless.",
    ambient:["wipes sweat from their brow but keeps working.","says the roads are busy with traders.","checks the watchtower more often these days.","trades with a passing merchant."],
  },
  autumn: {
    label:"Autumn", icon:"🍂", next:"winter",
    buildSlots:2, policyVote:true,
    incomeMult:1.00, freedMult:1.10, driftMult:1.00,
    crisisBias:"drought",
    forecast:"The harvest must hold. Dry weeks are coming.",
    ambient:["counts the harvest carefully.","worries the stores won't last.","says we should have built the barn first.","is preserving food for the cold months."],
  },
  winter: {
    label:"Winter", icon:"❄️", next:"spring",
    buildSlots:1, policyVote:false,
    incomeMult:0.75, freedMult:0.70, driftMult:1.40,
    crisisBias:"tax",
    forecast:"The roads are impassable. The Baron sends collectors.",
    ambient:["huddles close to the fire.","says the roads are impassable.","checks on the oldest members first thing in the morning.","is quiet today."],
  },
};
const SEASON_KEYS = ["spring","summer","autumn","winter"];

// Transition votes: shown at season start modal
const TRANSITION_VOTES = {
  spring: { question:"Spring opens — how does the commons face the growing season?", options:[
    { key:"grow",        label:"Prioritise growth",     desc:"Open doors policy active. +1 build slot this season.", effect:"openSlot" },
    { key:"consolidate", label:"Consolidate first",     desc:"XP gains +25% this season. Members deepen expertise.", effect:"xpBoost" },
  ]},
  summer: { question:"Summer's heat — the commons deliberates its pace.", options:[
    { key:"work",   label:"Work hard while it lasts", desc:"+10% more income this summer.", effect:"incomeBoost" },
    { key:"rest",   label:"Rest and tend to each other", desc:"Wellbeing drift −20% this summer. +5 wellbeing now.", effect:"wellBoost" },
  ]},
  autumn: { question:"Autumn — the harvest is in. How does the commons prepare?", options:[
    { key:"store",  label:"Build reserves",  desc:"20% of income this autumn saved to crisis fund.", effect:"reserveBoost" },
    { key:"share",  label:"Share the surplus", desc:"+12 wellbeing now. Solidarity active for 60s.", effect:"wellShare" },
  ]},
  winter: { question:"Winter descends. The commons must decide how to endure.", options:[
    { key:"ration", label:"Ration carefully", desc:"Income penalty reduced to −15% this winter.", effect:"rationIncome" },
    { key:"endure", label:"Endure together",  desc:"Wellbeing drift unchanged. Solidarity active for 90s.", effect:"endureSolidarity" },
  ]},
};

// ── POLICIES ─────────────────────────────────────────────────────────────────
const POLICIES = {
  allocation:{ label:"Income Allocation", emoji:"🪙", options:[
    { key:"high",   label:"Invest heavily",    desc:"50% of income → priority queue.", effect:{allocPct:50}, prefAff:["agrarian","craft"] },
    { key:"low",    label:"Stay liquid",        desc:"15% of income → priority queue.", effect:{allocPct:15}, prefAff:["knowledge","defense"] },
    { key:"medium", label:"Balanced",           desc:"30% of income → priority queue.", effect:{allocPct:30}, prefAff:[] },
  ]},
  labor:{ label:"Labor Policy", emoji:"👥", options:[
    { key:"open",        label:"Open doors",      desc:"Waive housing cap for 1 new member.", effect:{openDoors:true}, prefAff:["agrarian","stewardship"] },
    { key:"consolidate", label:"Consolidate",     desc:"No new members. XP +40%.",            effect:{xpBoost:1.4},   prefAff:["defense","craft"] },
    { key:"neutral",     label:"Steady as we go", desc:"Normal recruitment and XP.",           effect:{},              prefAff:[] },
  ]},
  mutualAid:{ label:"Mutual Aid Stance", emoji:"🤝", options:[
    { key:"outward", label:"Reach outward", desc:"Caravan cost −20%.",     effect:{caravanDiscount:0.8}, prefAff:["knowledge","stewardship"] },
    { key:"inward",  label:"Focus inward",  desc:"Wellbeing drift −30%.",  effect:{wellDriftMult:0.7},  prefAff:["craft","defense"] },
    { key:"neutral", label:"As needed",     desc:"Normal costs and drift.", effect:{},                   prefAff:[] },
  ]},
  crisisDoc:{ label:"Crisis Doctrine", emoji:"👑", phaseGate:"pressure", options:[
    { key:"reserves", label:"Build reserves",   desc:"10% of income → crisis fund, immune to raids.", effect:{reserveFrac:0.1}, prefAff:["defense","knowledge"] },
    { key:"liquid",   label:"Spend as we earn", desc:"No reserve. Full income available.",             effect:{reserveFrac:0},   prefAff:["agrarian","craft"] },
  ]},
};
const POLICY_KEYS = Object.keys(POLICIES);

// ── TREE ─────────────────────────────────────────────────────────────────────
const TREE = {
  commons:{ label:"Commons", emoji:"🏛️", color:"#c0a060", nodes:[
    { id:"garden",    name:"Commons Garden",   emoji:"🌱", cost:20,    income:0.4, path:"agrarian", desc:"Food from shared soil." },
    { id:"shelter",   name:"Common Shelter",   emoji:"🏚️", cost:90,    income:0,   houses:5,        desc:"Houses 5." },
    { id:"pasture",   name:"Commons Pasture",  emoji:"🐑", cost:700,   income:0,   freed:0.35,      desc:"Generates free time." },
    { id:"longhouse", name:"Sturdy Longhouse", emoji:"🏠", cost:2800,  income:0,   houses:7,        desc:"Houses 7." },
    { id:"hall",      name:"Commons Hall",     emoji:"🏛️", cost:8000,  income:0,   houses:9,        desc:"Houses 9." },
  ]},
  agrarian:{ label:"Agrarian", emoji:"🌾", color:"#80c040", nodes:[
    { id:"tended_garden", name:"Tended Garden",   emoji:"🌿", cost:200,   income:1.0, path:"agrarian", desc:"Proper tools and crop rotation." },
    { id:"mill",          name:"Grain Mill",       emoji:"⚙️", cost:1100,  income:2.8, path:"agrarian", desc:"Grinds grain for the whole valley." },
    { id:"bakery",        name:"Commons Bakery",   emoji:"🍞", cost:3500,  income:7.5, path:"agrarian", desc:"Bread for all; surplus sold to travelers." },
    { id:"brewery",       name:"Commons Brewery",  emoji:"🍺", cost:11000, income:21,  path:"agrarian", desc:"Ale and mead draw coin from afar." },
    { id:"grain_fed",     name:"Grain Federation", emoji:"🌾", cost:30000, income:56,  path:"agrarian", desc:"The commons feeds a region." },
  ]},
  craft:{ label:"Craft", emoji:"🔨", color:"#c09040", nodes:[
    { id:"workshop", name:"Craft Workshop",  emoji:"🪚", cost:200,   income:1.0, path:"craft", desc:"Furniture and cloth for trade." },
    { id:"forge",    name:"Collective Forge",emoji:"🔥", cost:1100,  income:2.8, path:"craft", desc:"Tools and ironwork, owned by all." },
    { id:"pottery",  name:"Pottery Works",   emoji:"🏺", cost:3500,  income:7.5, path:"craft", desc:"Vessels and tile, sold at market." },
    { id:"tannery",  name:"Tannery",         emoji:"🪵", cost:11000, income:21,  path:"craft", desc:"Leather goods command high prices." },
    { id:"guild",    name:"Artisans' Guild", emoji:"🎨", cost:30000, income:56,  path:"craft", desc:"The commons' craft is renowned." },
  ]},
  defense:{ label:"Defense", emoji:"⚔️", color:"#c04040", nodes:[
    { id:"training",   name:"Training Ground", emoji:"🏹", cost:200,   income:0.8, path:"defense", desc:"Militia training for all able members." },
    { id:"armory",     name:"Commons Armory",  emoji:"⚔️", cost:1100,  income:2.4, path:"defense", desc:"Weapons held in common, not by lords." },
    { id:"walls",      name:"Commons Walls",   emoji:"🧱", cost:3500,  income:6.3, path:"defense", desc:"Earthwork and timber ramparts." },
    { id:"watchtower", name:"Watchtower",      emoji:"🗼", cost:11000, income:18,  path:"defense", desc:"The commons sees trouble coming." },
    { id:"warhall",    name:"Warrior's Hall",  emoji:"🏯", cost:30000, income:49,  path:"defense", desc:"The commons fears no army." },
  ]},
  knowledge:{ label:"Knowledge", emoji:"📚", color:"#6080c0", nodes:[
    { id:"scriptorium", name:"Scriptorium",    emoji:"📜", cost:200,   income:0.8, path:"knowledge", freed:0.1,  desc:"Records and contracts for the region." },
    { id:"library",     name:"Library",        emoji:"📚", cost:1100,  income:2.4, path:"knowledge", freed:0.15, desc:"Knowledge draws scholars from afar." },
    { id:"apothecary",  name:"Apothecary",     emoji:"⚗️", cost:3500,  income:6.3, path:"knowledge",             desc:"Healing and herblore for all." },
    { id:"school",      name:"Commons School", emoji:"🏫", cost:11000, income:18,  path:"knowledge", freed:0.3,  desc:"Every child of the commons learns freely." },
    { id:"academy",     name:"Academy",        emoji:"🎓", cost:30000, income:49,  path:"knowledge", freed:0.5,  desc:"The commons shapes the region's thought." },
  ]},
};
const BRANCH_KEYS = Object.keys(TREE);
const NODE_INDEX  = {};
BRANCH_KEYS.forEach(bk => TREE[bk].nodes.forEach((n,idx) => { NODE_INDEX[n.id]={branch:bk,idx,node:n}; }));
const ALL_NODES   = BRANCH_KEYS.flatMap(bk => TREE[bk].nodes.map(n=>({...n,branch:bk})));

const isShelterNode    = id => !!NODE_INDEX[id]?.node?.houses;
const nodeHouses       = id => NODE_INDEX[id]?.node?.houses||0;
const housingCap       = built => Object.keys(built).filter(isShelterNode).reduce((s,id)=>s+nodeHouses(id),0);
const atCapacity       = (members,built) => members.length >= housingCap(built);
const nextNodeInBranch = (bk,built) => { for(const n of TREE[bk].nodes) if(!(n.id in built)) return n; return null; };
const isNodeBuildable  = (id,built) => { const info=NODE_INDEX[id]; if(!info||id in built) return false; if(info.idx===0) return true; return TREE[info.branch].nodes[info.idx-1].id in built; };

const EM_META = {};
[
  {id:"em_training",name:"Training Ground", emoji:"🏹",cost:600,income:4,path:"defense"},
  {id:"em_legal",   name:"Legal Hall",      emoji:"⚖️",cost:600,income:4,path:"knowledge"},
  {id:"em_market",  name:"Market Stall",    emoji:"🛒",cost:400,income:6,path:"craft"},
  {id:"em_tithe",   name:"Tithe Barn",      emoji:"🌾",cost:400,income:6,path:"agrarian"},
  {id:"em_irrig",   name:"Irrigation Ditch",emoji:"💧",cost:500,income:5,path:"agrarian"},
  {id:"em_grain",   name:"Grain Store",     emoji:"🏚️",cost:500,income:5,path:"agrarian"},
].forEach(b=>EM_META[b.id]=b);
const EMERGENCY_BUILDINGS = {
  conscription:[EM_META.em_training,EM_META.em_legal],
  tax:         [EM_META.em_market,  EM_META.em_tithe],
  drought:     [EM_META.em_irrig,   EM_META.em_grain],
};
const nodeIncome        = id => EM_META[id]?.income||NODE_INDEX[id]?.node?.income||0;
const nodePath          = id => EM_META[id]?.path  ||NODE_INDEX[id]?.node?.path  ||null;
const nodeDepthForBonus = id => EM_META[id]?1:(NODE_INDEX[id]?.idx??1);

// ── AFFINITIES ───────────────────────────────────────────────────────────────
const AFF = {
  agrarian:   {label:"Agrarian",   color:"#80c040",emoji:"🌾",scoreLabel:"Food"},
  craft:      {label:"Craft",      color:"#c09040",emoji:"🔨",scoreLabel:"Infra"},
  defense:    {label:"Defense",    color:"#c04040",emoji:"⚔️",scoreLabel:"Defense"},
  knowledge:  {label:"Knowledge",  color:"#6080c0",emoji:"📚",scoreLabel:"Knowledge"},
  stewardship:{label:"Stewardship",color:"#a060c0",emoji:"🐑",scoreLabel:"Care"},
};
const AFF_KEYS     = ["agrarian","craft","defense","knowledge"];
const ALL_AFF_KEYS = Object.keys(AFF);
const ADJACENT = {
  agrarian:   ["craft","knowledge","stewardship"],
  craft:      ["agrarian","defense"],
  defense:    ["craft","knowledge"],
  knowledge:  ["agrarian","defense","stewardship"],
  stewardship:["agrarian","knowledge"],
};

const depthScore    = (m,k) => DEPTH_MULTS[Math.min(Math.floor(m.depth?.[k]||0),3)]||1;
const affScore      = m => { const c={}; m.affinities.forEach(a=>c[a]=(c[a]||0)+1); const r={agrarian:0,craft:0,defense:0,knowledge:0}; AFF_KEYS.forEach(k=>{if(c[k]) r[k]=c[k]*c[k]*depthScore(m,k);}); return r; };
const computeScores = (members,built) => {
  const s={agrarian:0,craft:0,defense:0,knowledge:0};
  members.forEach(m=>{const ms=affScore(m);AFF_KEYS.forEach(k=>s[k]+=ms[k]);});
  Object.keys(built).forEach(id=>{let p=nodePath(id);if(isShelterNode(id))p="craft";if(p&&AFF_KEYS.includes(p))s[p]+=(nodeDepthForBonus(id)+2);});
  return s;
};
const crisisThreshold = n => Math.round(6+n*1.2);

const wellbeingStatus = w => {
  if(w>=80) return{label:"Thriving", color:"#80f080",resBonus: 1,incMult:1.1 };
  if(w>=60) return{label:"Content",  color:"#a0d060",resBonus: 0,incMult:1.0 };
  if(w>=40) return{label:"Steady",   color:"#c0c060",resBonus: 0,incMult:0.9 };
  if(w>=20) return{label:"Strained", color:"#e0a040",resBonus:-1,incMult:0.75};
  return         {label:"Suffering", color:"#f06060",resBonus:-2,incMult:0.55};
};
const trainCost = (isRetrain,fromAff,toAff) => { const base=isRetrain?RETRAIN_ADJ:TRAIN_ADJ,far=isRetrain?RETRAIN_DIST:TRAIN_DIST; return(ADJACENT[fromAff]||[]).includes(toAff)?base:far; };

// ── MEMBER POOL ───────────────────────────────────────────────────────────────
const MEMBER_POOL = [
  {name:"Rosa", title:"Weaver",     affinities:["craft"],    emoji:"🧵"},
  {name:"Finn", title:"Miller",     affinities:["agrarian"], emoji:"🌾"},
  {name:"Aisha",title:"Herbalist",  affinities:["knowledge"],emoji:"🌿"},
  {name:"Tariq",title:"Cooper",     affinities:["craft"],    emoji:"🪣"},
  {name:"Marta",title:"Shepherd",   affinities:["agrarian"], emoji:"🐑"},
  {name:"Oswin",title:"Scout",      affinities:["defense"],  emoji:"🏹"},
  {name:"Priya",title:"Dyer",       affinities:["craft"],    emoji:"🎨"},
  {name:"Leon", title:"Tanner",     affinities:["craft"],    emoji:"🪵"},
  {name:"Suki", title:"Potter",     affinities:["agrarian"], emoji:"🏺"},
  {name:"Dante",title:"Thatcher",   affinities:["defense"],  emoji:"⚔️"},
  {name:"Elara",title:"Scribe",     affinities:["knowledge"],emoji:"📜"},
  {name:"Bram", title:"Blacksmith", affinities:["defense"],  emoji:"🔥"},
  {name:"Ida",  title:"Brewer",     affinities:["agrarian"], emoji:"🍺"},
  {name:"Colt", title:"Carpenter",  affinities:["craft"],    emoji:"🪚"},
  {name:"Nessa",title:"Apothecary", affinities:["knowledge"],emoji:"⚗️"},
  {name:"Wren", title:"Fisher",     affinities:["agrarian"], emoji:"🎣"},
  {name:"Hale", title:"Soldier",    affinities:["defense"],  emoji:"🗡️"},
  {name:"Bea",  title:"Midwife",    affinities:["knowledge"],emoji:"💊"},
  {name:"Georg",title:"Merchant",   affinities:["craft"],    emoji:"💰"},
  {name:"Yara", title:"Archer",     affinities:["defense"],  emoji:"🏹"},
];
const mkMember = pe => ({...pe,affinities:[...pe.affinities],xp:0,level:1,depth:{agrarian:0,craft:0,defense:0,knowledge:0,stewardship:0},depthXp:{}});
const xpThresh = m => XP_PER_LEVEL[Math.min((m.level||1)-1,2)];
const isAtCap  = m => m.affinities.length>=3;
const isElder  = m => m.affinities.every(a=>(m.depth?.[a]||0)>=3);
const isMentor = m => !isElder(m)&&Object.values(m.depth||{}).some(d=>d>=3);
const isReady  = m => (m.xp||0)>=xpThresh(m)&&!isAtCap(m);

// ── CRISES ────────────────────────────────────────────────────────────────────
const CRISIS_TEMPLATES = [
  {id:"tax",         label:"Royal Tax Edict",   icon:"👑",warning:c=>`The Baron will demand ${c} coins.`,        shiftToward:"agrarian"},
  {id:"conscription",label:"Royal Conscription",icon:"⚔️",warning:()=>`The Kingdom issues conscription notices.`,shiftToward:"defense"},
  {id:"drought",     label:"Season of Drought", icon:"☀️",warning:()=>`Dry weeks threaten the harvest.`,        shiftToward:"agrarian"},
];
const resolveCrisis = (template,scores,coins,members,wellbeing) => {
  const thr=crisisThreshold(members.length),half=thr/2;
  const pm={tax:"knowledge",conscription:"defense",drought:"agrarian"};
  const primary=(scores[pm[template.id]]||0)+wellbeingStatus(wellbeing).resBonus;
  const tax=80+members.length*30;
  const wh=-Math.floor(wellbeing*0.3),wf=-Math.floor(wellbeing*0.5);
  if(primary>=thr) return{severity:"none",coinDelta:0,      loseMember:false,razeBuilding:false,wellDelta:0, msg:`The commons' strength turns the crisis aside.`,                              title:"Crisis Averted"};
  if(primary>=half){
    if(template.id==="tax")          return{severity:"half",coinDelta:-Math.floor(tax*0.3),  loseMember:false,razeBuilding:false,wellDelta:wh,msg:`Partially prepared — paid reduced tax of ${Math.floor(tax*0.3)} coins.`,title:"Partial Damage"};
    if(template.id==="conscription") return{severity:"half",coinDelta:0,                     loseMember:false,razeBuilding:true, wellDelta:wh,msg:`The commons held off the soldiers, but they burned a building.`,         title:"Building Razed"};
    if(template.id==="drought")      return{severity:"half",coinDelta:-Math.floor(tax*0.25), loseMember:false,razeBuilding:false,wellDelta:wh,msg:`The harvest was thin.`,                                                   title:"Partial Damage"};
  }
  if(template.id==="tax")          return{severity:"full",coinDelta:-Math.floor(coins*0.75),loseMember:false,razeBuilding:false,wellDelta:wf,msg:`Soldiers take nearly everything. Treasury gutted.`,title:"Treasury Gutted"};
  if(template.id==="conscription") return{severity:"full",coinDelta:0,                      loseMember:true, razeBuilding:false,wellDelta:wf,msg:`The soldiers take a commons member.`,              title:"Member Taken"};
  return                            {severity:"full",coinDelta:-Math.floor(coins*0.6),       loseMember:false,razeBuilding:false,wellDelta:wf,msg:`The drought devastates the commons.`,              title:"Harvest Failed"};
};

const NEIGHBOR_EVENTS = [
  {id:"flood",   icon:"🌊",title:"Flood Refugees",        desc:"A nearby village has been flooded.",                                members:[{affinities:["agrarian"],emoji:"🌾",name:"Petra",title:"Farmer"},{affinities:["craft"],emoji:"🪚",name:"Milo",title:"Carpenter"}],  options:[{label:"Welcome all",key:"all"},{label:"Welcome some",key:"partial"},{label:"Send supplies only",key:"none",coinDelta:-200}]},
  {id:"wanderer",icon:"🚶",title:"Wandering Craftspeople", desc:"Displaced artisans have heard of what you're building.",          members:[{affinities:["craft"],emoji:"🧵",name:"Vera",title:"Weaver"},{affinities:["craft"],emoji:"🪚",name:"Dax",title:"Carpenter"}],    options:[{label:"Welcome all",key:"all"},{label:"Welcome some",key:"partial"},{label:"Share what we can",key:"none",coinDelta:-150}]},
  {id:"scholars",icon:"📜",title:"Expelled Scholars",      desc:"Scholars expelled for writing about workers' rights seek a home.",members:[{affinities:["knowledge"],emoji:"📜",name:"Cas",title:"Scribe"},{affinities:["knowledge"],emoji:"📚",name:"Lev",title:"Scholar"}],options:[{label:"Welcome all",key:"all"},{label:"Welcome some",key:"partial"},{label:"Send word ahead",key:"none",coinDelta:0}]},
];

const AMBIENT_BASE = {
  agrarian:   ["tends the garden before dawn.","checks the grain stores.","worries about the next frost.","hums while kneading bread."],
  craft:      ["sharpens tools by the fire.","is repairing the workshop roof.","trades goods with a passing merchant.","shows an apprentice the loom."],
  defense:    ["watches the eastern road.","drills with a wooden sword.","says the walls need to be higher.","checks the commons' weapons."],
  knowledge:  ["is reading by candlelight.","copies the commons' charter.","argues about the law.","writes letters to other villages."],
  stewardship:["checks on the animals.","brushes the sheep at dawn.","says the goat escaped again.","sits quietly with the animals for a while."],
};

// ── PROPOSAL HELPERS ──────────────────────────────────────────────────────────
const getMemberProposal=(member,built)=>{const s=affScore(member);const top=AFF_KEYS.reduce((a,b)=>(s[a]||0)>=(s[b]||0)?a:b);const cands=[];BRANCH_KEYS.forEach(bk=>{const n=nextNodeInBranch(bk,built);if(!n)return;const sc=n.path===top?3:((ADJACENT[top]||[]).includes(n.path)?1:0);cands.push({node:n,score:sc+Math.random()*0.5});});cands.sort((a,b)=>b.score-a.score);return cands[0]?.node||null;};
const buildProposalSlate=(members,built,playerNom)=>{const proposals=[],seen=new Set();if(playerNom&&isNodeBuildable(playerNom.id,built)){proposals.push({node:playerNom,proposer:"You",proposerEmoji:"👤"});seen.add(playerNom.id);}for(const m of[...members.filter(m=>m.name!=="You")].sort(()=>Math.random()-0.5)){if(proposals.length>=4)break;const node=getMemberProposal(m,built);if(!node||seen.has(node.id))continue;seen.add(node.id);proposals.push({node,proposer:m.name,proposerEmoji:m.emoji});}BRANCH_KEYS.forEach(bk=>{if(proposals.length>=3)return;const n=nextNodeInBranch(bk,built);if(n&&!seen.has(n.id)){seen.add(n.id);proposals.push({node:n,proposer:"The commons",proposerEmoji:"🏛️"});}});return proposals;};
const getMemberVoteFor=(member,proposals)=>{const s=affScore(member);let best=0,bestScore=-1;proposals.forEach((p,i)=>{const sc=(p.node.path?(s[p.node.path]||0):0.5)+(Math.random()-0.5)*1.5;if(sc>bestScore){bestScore=sc;best=i;}});return best;};
const getMemberPolicyVote=(member,options)=>{let best=0,bestScore=-1;options.forEach((opt,i)=>{const sc=opt.prefAff.filter(a=>member.affinities.includes(a)).length+(Math.random()-0.5)*1.2;if(sc>bestScore){bestScore=sc;best=i;}});return best;};
const getMemberTransitionVote=(member,options)=>{return Math.floor(Math.random()*options.length);};

// ── STYLES ───────────────────────────────────────────────────────────────────
const C={panel:"#23120799",border:"#5a3a1a",gold:"#f0c060",tan:"#c9a870",dim:"#7a5a30",green:"#80c040",text:"#f0e0c0"};
const S={
  app:{minHeight:"100vh",background:"linear-gradient(160deg,#2d1a0e,#3d2010,#1a0d05)",fontFamily:"Georgia,serif",color:C.text,paddingBottom:60},
  hdr:{background:"linear-gradient(90deg,#12080200,#2d150a,#12080200)",borderBottom:`2px solid ${C.border}`,padding:"14px 16px",textAlign:"center"},
  h1:{margin:0,fontSize:24,color:C.gold,letterSpacing:3,textShadow:"0 2px 8px #000a"},
  wrap:{padding:"0 14px"},
  card:{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",marginTop:12},
  lbl:{fontSize:10,letterSpacing:2,color:C.dim,textTransform:"uppercase",marginBottom:6,borderBottom:`1px solid ${C.border}`,paddingBottom:3},
  goalBar:{height:10,borderRadius:5,background:"#1a0d05",border:`1px solid ${C.border}`,overflow:"hidden",marginTop:6},
  goalFill:{height:"100%",background:"linear-gradient(90deg,#60a020,#a0d040)",transition:"width 0.4s"},
  ownedRow:{display:"flex",alignItems:"center",gap:8,background:"#0d0803cc",border:"1px solid #304010",borderRadius:8,padding:"8px 10px",marginBottom:6},
  log:{background:"#0d080399",border:`1px solid #2a1a08`,borderRadius:8,padding:"10px 12px",maxHeight:130,overflowY:"auto",fontSize:12,color:C.tan,lineHeight:1.7},
  modal:{position:"fixed",inset:0,background:"#000000bb",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:16},
  mBox:{background:"linear-gradient(160deg,#2d1a0e,#1a0d05)",border:`2px solid ${C.gold}`,borderRadius:12,padding:22,maxWidth:400,width:"100%",maxHeight:"88vh",overflowY:"auto"},
  mTitle:{fontSize:18,fontWeight:"bold",color:C.gold,marginBottom:8,textAlign:"center"},
  mText:{fontSize:13,color:C.text,lineHeight:1.6,marginBottom:14,textAlign:"center"},
  mBtn:{flex:1,minWidth:100,background:"linear-gradient(180deg,#4a3010,#2d1a05)",border:`2px solid ${C.gold}`,borderRadius:8,color:C.gold,fontSize:13,padding:"10px 12px",cursor:"pointer"},
  xpBar:{height:4,borderRadius:2,background:"#1a1005",overflow:"hidden",marginTop:3},
  xpFill:{height:"100%",background:"linear-gradient(90deg,#6040c0,#a060f0)",transition:"width 0.4s"},
};

const PHASE_GOALS={
  survival: {label:"Survive the Winter",     desc:"Build the Commons Garden and Common Shelter."},
  start:    {label:"Start the Commons",       desc:"Build any 2 more nodes from the skill tree."},
  firstVote:{label:"Set a Priority Together", desc:"Hold your first assembly vote and commit to a shared build."},
  grow:     {label:"Grow Stronger",           desc:"Need 10+ members and all scores ≥ threshold."},
  pressure: {label:"Free the Commons",        desc:"Endure the Kingdom's crises — or spread the model."},
};

// ── COMPONENT ─────────────────────────────────────────────────────────────────
export default function GuildRising(){
  const founderAff=useRef(AFF_KEYS[Math.floor(Math.random()*AFF_KEYS.length)]);

  // ── STATE ──────────────────────────────────────────────────────────────────
  const [coins,setCoins]                       = useState(0);
  const [perSec,setPerSec]                     = useState(0);
  const [members,setMembers]                   = useState([{name:"You",title:"Founder",affinities:[founderAff.current],emoji:"👤",xp:0,level:1,depth:{agrarian:0,craft:0,defense:0,knowledge:0,stewardship:0},depthXp:{}}]);
  const [built,setBuilt]                       = useState({});
  const [log,setLog]                           = useState(["The commons stirs. Survival demands it."]);
  const [phase,setPhase]                       = useState("survival");
  const [completedGoals,setCompletedGoals]     = useState([]);
  const [goalBanner,setGoalBanner]             = useState(null);
  const [solidarityTicks,setSolidarityTicks]   = useState(0);
  const [crisesWeathered,setCrisesWeathered]   = useState(0);
  const [completeCrises,setCompleteCrises]     = useState(0);
  const [victory,setVictory]                   = useState(null);
  const [freedHours,setFreedHours]             = useState(0);
  const [sisterCommons,setSisterCommons]       = useState(0);
  const [wellbeing,setWellbeing]               = useState(WELLBEING_START);
  const [activeCrisis,setActiveCrisis]         = useState(null);
  const [crisisWarning,setCrisisWarning]       = useState(null);
  const [emergencyPair,setEmergencyPair]       = useState(null);
  const [crisisResult,setCrisisResult]         = useState(null);
  const [neighborEvent,setNeighborEvent]       = useState(null);
  const [reserveFund,setReserveFund]           = useState(0);
  const [coinAnim,setCoinAnim]                 = useState(false);
  const [coinPops,setCoinPops]                 = useState([]);
  const [freedPops,setFreedPops]               = useState([]);
  const [treeBranch,setTreeBranch]             = useState("commons");
  const [activeVote,setActiveVote]             = useState(null);
  const [activePolicyVote,setActivePolicyVote] = useState(null);
  const [nominationPick,setNominationPick]     = useState(null);
  const [nominating,setNominating]             = useState(false);
  const [priorityQueue,setPriorityQueue]       = useState([]);
  const [firstVoteHeld,setFirstVoteHeld]       = useState(false);
  const [charter,setCharter]                   = useState({allocation:"medium",labor:"neutral",mutualAid:"neutral",crisisDoc:"liquid"});
  const [policyResult,setPolicyResult]         = useState(null);
  const [levelUpModal,setLevelUpModal]         = useState(null);
  const [trainModal,setTrainModal]             = useState(null);
  const [retrainModal,setRetrainModal]         = useState(null);
  const [retrainRemove,setRetrainRemove]       = useState(null);
  const [proposalCooldownDisplay,setProposalCooldownDisplay] = useState(8);
  const [policyCooldownDisplay,setPolicyCooldownDisplay]     = useState(POLICY_COOLDOWN+200);

  // Season state
  const [season,setSeason]           = useState("spring");
  const [seasonTick,setSeasonTick]   = useState(0);
  const [year,setYear]               = useState(1);
  const [buildSlotsTotal,setBuildSlotsTotal]   = useState(3);
  const [buildSlotsUsed,setBuildSlotsUsed]     = useState(0);
  const [policySlotsUsed,setPolicySlotsUsed]   = useState(0);
  const [transitionModal,setTransitionModal]   = useState(null);
  // Season override effects from transition votes
  const [seasonOverride,setSeasonOverride]     = useState({});
  // Season summary for outgoing screen
  const [seasonSummary,setSeasonSummary]       = useState({buildsCompleted:[],crisesTotal:0,crisesThisSeason:0,slotsUsed:0,slotsTotal:3});

  // ── REFS ───────────────────────────────────────────────────────────────────
  const phaseRef            = useRef("survival"); phaseRef.current            = phase;
  const crisisRef           = useRef(null);       crisisRef.current           = activeCrisis;
  const coinsRef            = useRef(0);          coinsRef.current            = coins;
  const membersRef          = useRef(members);    membersRef.current          = members;
  const builtRef            = useRef(built);      builtRef.current            = built;
  const solidarityRef       = useRef(0);          solidarityRef.current       = solidarityTicks;
  const priorityQueueRef    = useRef([]);         priorityQueueRef.current    = priorityQueue;
  const activeVoteRef       = useRef(null);       activeVoteRef.current       = activeVote;
  const activePolicyVoteRef = useRef(null);       activePolicyVoteRef.current = activePolicyVote;
  const wellbeingRef        = useRef(WELLBEING_START); wellbeingRef.current   = wellbeing;
  const charterRef          = useRef(charter);    charterRef.current          = charter;
  const reserveFundRef      = useRef(0);          reserveFundRef.current      = reserveFund;
  const neighborRef         = useRef(null);       neighborRef.current         = neighborEvent;
  const firstVoteHeldRef    = useRef(false);      firstVoteHeldRef.current    = firstVoteHeld;
  const nominationPickRef   = useRef(null);       nominationPickRef.current   = nominationPick;
  const seasonRef           = useRef("spring");   seasonRef.current           = season;
  const seasonTickRef       = useRef(0);          seasonTickRef.current       = seasonTick;
  const buildSlotsUsedRef   = useRef(0);          buildSlotsUsedRef.current   = buildSlotsUsed;
  const buildSlotsTotalRef  = useRef(3);          buildSlotsTotalRef.current  = buildSlotsTotal;
  const seasonOverrideRef   = useRef({});         seasonOverrideRef.current   = seasonOverride;
  const transitionModalRef  = useRef(null);       transitionModalRef.current  = transitionModal;
  const policySlotsUsedRef  = useRef(0);          policySlotsUsedRef.current  = policySlotsUsed;
  const crisisQueueRef      = useRef(400);
  const neighborQueueRef    = useRef(350);
  const proposalCooldownRef = useRef(8);
  const policyCooldownRef   = useRef(POLICY_COOLDOWN+200);
  const victoryShownRef     = useRef(false);
  const seasonBuildsRef     = useRef([]);  // tracks builds completed this season

  // ── HELPERS ────────────────────────────────────────────────────────────────
  const addLog          = msg => setLog(l=>[msg,...l].slice(0,60));
  const adjustWellbeing = d   => setWellbeing(w=>Math.max(0,Math.min(100,+(w+d).toFixed(1))));

  const getSeasonMods = () => {
    const s   = SEASONS[seasonRef.current];
    const ov  = seasonOverrideRef.current;
    return {
      incomeMult: (s.incomeMult) * (ov.incomeMult||1),
      freedMult:  (s.freedMult)  * (ov.freedMult||1),
      driftMult:  (s.driftMult)  * (ov.driftMult||1),
      reserveBoost: ov.reserveBoost||0,
    };
  };

  const charterEffect       = key => charterRef.current[key];
  const caravanDiscount     = () => POLICIES.mutualAid.options.find(o=>o.key===charterEffect("mutualAid"))?.effect?.caravanDiscount??1;
  const wellDriftMult       = () => POLICIES.mutualAid.options.find(o=>o.key===charterEffect("mutualAid"))?.effect?.wellDriftMult??1;
  const xpBoost             = () => POLICIES.labor.options.find(o=>o.key===charterEffect("labor"))?.effect?.xpBoost??1;
  const reserveFrac         = () => POLICIES.crisisDoc.options.find(o=>o.key===charterEffect("crisisDoc"))?.effect?.reserveFrac??0;

  const hasBuildSlots       = () => buildSlotsUsedRef.current < buildSlotsTotalRef.current;
  const hasPolicySlots      = () => SEASONS[seasonRef.current].policyVote && policySlotsUsedRef.current < 1;

  const computeIncome=(builtObj,memberList)=>{let total=0;const ms={agrarian:0,craft:0,defense:0,knowledge:0};memberList.forEach(m=>{const s=affScore(m);AFF_KEYS.forEach(k=>ms[k]+=s[k]);});Object.keys(builtObj).forEach(id=>{const inc=nodeIncome(id),path=nodePath(id),depth=nodeDepthForBonus(id);total+=inc+(path&&AFF_KEYS.includes(path)?ms[path]*(TIER_BONUS_MULT[Math.min(depth,4)]||1):0);});return total;};
  const freedGenFor=(builtObj,memberList)=>{const stewards=memberList.reduce((s,m)=>s+m.affinities.filter(a=>a==="stewardship").length,0);let g=0;Object.keys(builtObj).forEach(id=>{const n=NODE_INDEX[id]?.node;if(n?.freed)g+=n.freed;});return g*(1+stewards*0.15);};

  const completeNode=(nodeId,top)=>{
    setBuilt(b=>{
      if(b[nodeId])return b;
      const nb={...b,[nodeId]:true};
      if(!isShelterNode(nodeId)&&top.node.path){
        const used=membersRef.current.map(m=>m.name);
        const openDoors=POLICIES.labor.options.find(o=>o.key===charterRef.current.labor)?.effect?.openDoors||seasonOverrideRef.current.openDoors;
        const effCap=housingCap(nb)+(openDoors?1:0);
        const r=MEMBER_POOL.find(m=>!used.includes(m.name)&&m.affinities[0]===top.node.path)||MEMBER_POOL.find(m=>!used.includes(m.name));
        if(r&&membersRef.current.length<effCap)setMembers(ms=>[...ms,mkMember(r)]);
      }
      if(nodeId==="pasture"){setMembers(ms=>{const cand=ms.find(m=>!m.affinities.includes("stewardship"));if(cand)return ms.map(m=>m.name===cand.name?{...m,affinities:[...m.affinities,"stewardship"]}:m);return ms;});adjustWellbeing(5);}
      return nb;
    });
    seasonBuildsRef.current=[...seasonBuildsRef.current,top.node.name];
    addLog(`🏗️ "${top.node.emoji} ${top.node.name}" is complete.`);
    adjustWellbeing(3);
  };

  // Apply transition vote effect
  const applyTransitionEffect=(effect)=>{
    const ov={};
    if(effect==="openSlot") setBuildSlotsTotal(t=>t+1);
    if(effect==="xpBoost")  ov.xpBoost=1.25;
    if(effect==="incomeBoost") ov.incomeMult=1.1;
    if(effect==="wellBoost"){adjustWellbeing(5);ov.driftMult=0.8;}
    if(effect==="reserveBoost") ov.reserveBoost=0.2;
    if(effect==="wellShare"){adjustWellbeing(12);setSolidarityTicks(SOLIDARITY_TICKS);}
    if(effect==="rationIncome") ov.incomeMult=SEASONS.winter.incomeMult/0.75*0.85; // soften penalty
    if(effect==="endureSolidarity"){ov.driftMult=1.0;setSolidarityTicks(SOLIDARITY_TICKS*1.5);}
    setSeasonOverride(ov);
  };

  // ── EFFECTS ────────────────────────────────────────────────────────────────
  useEffect(()=>{setPerSec(p=>{const v=+computeIncome(built,members).toFixed(1);return v!==p?v:p;});},[built,members]);
  useEffect(()=>{if(victoryShownRef.current)return;const endure=completeCrises>=VICTORY_CRISES,spread=sisterCommons>=SISTER_VICTORY;if(endure||spread){victoryShownRef.current=true;setVictory({path:spread&&!endure?"spread":"endure",members:membersRef.current.length,buildings:Object.keys(builtRef.current).length,crises:crisesWeathered,sisters:sisterCommons});}},[completeCrises,sisterCommons,crisesWeathered]);

  // ── MAIN TICK ───────────────────────────────────────────────────────────────
  useEffect(()=>{
    let ambTick=0;
    const finalizeVote=(vote,membersNow)=>{
      if(!vote)return;
      const tally=vote.proposals.map(()=>0);
      vote.memberVotes.forEach(mv=>{if(mv.vote!=null&&tally[mv.vote]!==undefined)tally[mv.vote]++;});
      if(vote.playerVote!=null&&tally[vote.playerVote]!==undefined)tally[vote.playerVote]++;
      let winner=0;tally.forEach((t,i)=>{if(t>tally[winner])winner=i;});
      const wp=vote.proposals[winner];const wn=wp?.node;if(!wn)return;
      addLog(`🗳️ "${wn.name}" wins (${tally[winner]}/${membersNow.length} votes). Building begins.`);
      setPriorityQueue(q=>q.some(i=>i.node.id===wn.id)?q:[...q,{node:wn,funded:0,total:wn.cost,proposer:wp.proposer}]);
      if(!firstVoteHeldRef.current){setFirstVoteHeld(true);setCompletedGoals(g=>g.includes("firstVote")?g:[...g,"firstVote"]);setGoalBanner("🗳️ The commons sets its first shared priority. This is what democracy looks like.");setTimeout(()=>setGoalBanner(null),5000);}
      setActiveVote(null);
    };
    const finalizePolicyVote=(pv,membersNow)=>{
      if(!pv)return;
      const tally=pv.options.map(()=>0);
      pv.memberVotes.forEach(mv=>{if(mv.vote!=null&&tally[mv.vote]!==undefined)tally[mv.vote]++;});
      if(pv.playerVote!=null&&tally[pv.playerVote]!==undefined)tally[pv.playerVote]++;
      let winner=0;tally.forEach((t,i)=>{if(t>tally[winner])winner=i;});
      const winOpt=pv.options[winner];
      setCharter(ch=>({...ch,[pv.policyKey]:winOpt.key}));
      addLog(`🏛️ Charter: ${POLICIES[pv.policyKey]?.label} → "${winOpt.label}" (${tally[winner]}/${membersNow.length}).`);
      setPolicyResult({policyKey:pv.policyKey,policyLabel:POLICIES[pv.policyKey]?.label,winOption:winOpt,tally,total:membersNow.length});
      setActivePolicyVote(null);
    };

    const iv=setInterval(()=>{
      // Skip tick while transition modal is open
      if(transitionModalRef.current)return;

      const rawInc=computeIncome(builtRef.current,membersRef.current);
      const mods=getSeasonMods();
      const inc=rawInc*wellbeingStatus(wellbeingRef.current).incMult*mods.incomeMult;
      const dt=TICK_MS/1000;

      setCoins(c=>+(c+inc*TREASURY_ALLOC_FRAC*dt).toFixed(2));
      const rf=reserveFrac()+(mods.reserveBoost||0);
      if(rf>0){const r=inc*rf*dt;setReserveFund(f=>+(f+r).toFixed(2));setCoins(c=>+(c-r).toFixed(2));}

      const queue=priorityQueueRef.current;
      if(queue.length>0){const gain=inc*QUEUE_ALLOC_FRAC*dt;const top=queue[0];const nf=top.funded+gain;if(nf>=top.total){setPriorityQueue(q=>q.slice(1));completeNode(top.node.id,top);}else setPriorityQueue(q=>q.length>0?[{...q[0],funded:nf},...q.slice(1)]:q);}

      let freedGen=freedGenFor(builtRef.current,membersRef.current)*mods.freedMult;
      if(coinsRef.current>4000)freedGen*=HOARD_DAMPEN;
      if(freedGen>0)setFreedHours(f=>+(f+freedGen*dt).toFixed(2));

      const drift=solidarityRef.current>0?0:WELLBEING_DRIFT*mods.driftMult*wellDriftMult();
      setWellbeing(w=>Math.max(0,+(w-drift).toFixed(2)));

      // XP
      const xpMult=(solidarityRef.current>0?SOLIDARITY_XP_MULT:1)*xpBoost()*(seasonOverrideRef.current.xpBoost||1);
      const paths=Object.keys(builtRef.current).map(id=>nodePath(id)).filter(p=>p&&AFF_KEYS.includes(p));
      const mentorB={agrarian:0,craft:0,defense:0,knowledge:0};
      membersRef.current.forEach(m=>{AFF_KEYS.forEach(k=>{if((m.depth?.[k]||0)>=3)mentorB[k]+=0.15;});});
      setMembers(ms=>ms.map(m=>{
        if(isElder(m))return m;
        const s=affScore(m);const matches=paths.reduce((sum,p)=>sum+(s[p]||0),0);const baseGain=matches*0.3*xpMult;
        if(isAtCap(m)){if(!baseGain)return m;const nd={...m.depth},ndx={...(m.depthXp||{})};m.affinities.forEach(aff=>{if(!AFF_KEYS.includes(aff))return;const cl=Math.floor(nd[aff]||0);if(cl>=3)return;const acc=(ndx[aff]||0)+(baseGain/m.affinities.length)*(1+(mentorB[aff]||0))*3;const need=DEPTH_XP[Math.min(cl,2)];if(acc>=need){nd[aff]=cl+1;ndx[aff]=0;}else ndx[aff]=acc;});return{...m,depth:nd,depthXp:ndx};}
        if(!baseGain)return m;return{...m,xp:(m.xp||0)+baseGain};
      }));
      if(solidarityRef.current>0)setSolidarityTicks(st=>st>0?st-1:0);

      // ── Season tick ──────────────────────────────────────────────────────
      const newSeasonTick=seasonTickRef.current+1;
      setSeasonTick(newSeasonTick);
      if(newSeasonTick>=SEASON_LENGTH){
        // Prepare transition
        const outgoing=seasonRef.current;
        const incoming=SEASONS[outgoing].next;
        const incomingSeason=SEASONS[incoming];
        const isNewYear=incoming==="spring";
        const summary={buildsCompleted:[...seasonBuildsRef.current],slotsUsed:buildSlotsUsedRef.current,slotsTotal:buildSlotsTotalRef.current,crisisCount:0};
        // Pick a random member voice
        const pool=membersRef.current.filter(m=>m.name!=="You");
        const voice=pool.length?pool[Math.floor(Math.random()*pool.length)]:null;
        // Build transition vote
        const tvDef=TRANSITION_VOTES[incoming];
        const tvMemberVotes=membersRef.current.filter(m=>m.name!=="You").map(m=>({name:m.name,emoji:m.emoji,vote:getMemberTransitionVote(m,tvDef.options)}));
        setTransitionModal({
          step:"outgoing",
          outgoing,outgoingLabel:SEASONS[outgoing].label,outgoingIcon:SEASONS[outgoing].icon,
          incoming,incomingLabel:incomingSeason.label,incomingIcon:incomingSeason.icon,
          incomingSeason,isNewYear,
          summary,voice,
          transitionVote:{...tvDef,memberVotes:tvMemberVotes,playerVote:null},
        });
        setSeasonTick(0);
        const newYear=isNewYear?year+1:year;
        if(isNewYear)setYear(newYear);
        setSeason(incoming);
        setBuildSlotsTotal(incomingSeason.buildSlots);
        setBuildSlotsUsed(0);
        setPolicySlotsUsed(0);
        setSeasonOverride({});
        seasonBuildsRef.current=[];
        addLog(`${incomingSeason.icon} ${incomingSeason.label} begins${isNewYear?` — Year ${newYear}`:""}. ${incomingSeason.forecast}`);
        return;
      }

      // Ambient (season-aware)
      ambTick++;
      if(ambTick%22===0){
        const pool=membersRef.current.filter(m=>m.name!=="You");
        if(pool.length){
          const m=pool[Math.floor(Math.random()*pool.length)];
          const seasonAmb=SEASONS[seasonRef.current].ambient;
          // 40% chance of season ambient, 60% affinity ambient
          const useSeasonLine=Math.random()<0.4;
          const line=useSeasonLine?seasonAmb[Math.floor(Math.random()*seasonAmb.length)]:(AMBIENT_BASE[m.affinities[m.affinities.length-1]]||AMBIENT_BASE.agrarian)[Math.floor(Math.random()*4)];
          addLog(`${m.emoji} ${m.name} ${line}`);
        }
      }

      if(phaseRef.current==="survival")return;

      // Vote countdowns
      {const av=activeVoteRef.current;if(av){if(av.ticksLeft<=1)finalizeVote(av,membersRef.current);else setActiveVote(v=>v?{...v,ticksLeft:v.ticksLeft-1}:v);}}
      {const apv=activePolicyVoteRef.current;if(apv){if(apv.ticksLeft<=1)finalizePolicyVote(apv,membersRef.current);else setActivePolicyVote(v=>v?{...v,ticksLeft:v.ticksLeft-1}:v);}}

      // Cooldowns (build)
      if(!activeVoteRef.current&&!activePolicyVoteRef.current){
        proposalCooldownRef.current=Math.max(0,proposalCooldownRef.current-1);
        setProposalCooldownDisplay(proposalCooldownRef.current);
      }
      // Policy cooldown (separate track)
      if(!activePolicyVoteRef.current){
        policyCooldownRef.current=Math.max(0,policyCooldownRef.current-1);
        setPolicyCooldownDisplay(policyCooldownRef.current);
      }

      // Trigger policy vote (separate track, slot-gated)
      if(!activePolicyVoteRef.current&&policyCooldownRef.current===0&&hasPolicySlots()){
        const eligible=POLICY_KEYS.filter(k=>!POLICIES[k].phaseGate||POLICIES[k].phaseGate===phaseRef.current);
        if(eligible.length){
          const pKey=eligible[Math.floor(Math.random()*eligible.length)];
          const opts=POLICIES[pKey].options;
          const mv=membersRef.current.filter(m=>m.name!=="You").map(m=>({name:m.name,emoji:m.emoji,vote:getMemberPolicyVote(m,opts)}));
          setActivePolicyVote({policyKey:pKey,options:opts,memberVotes:mv,playerVote:null,ticksLeft:VOTE_WINDOW_TICKS});
          setPolicySlotsUsed(n=>n+1);
          addLog(`🏛️ Policy assembly: ${POLICIES[pKey].label}.`);
          policyCooldownRef.current=POLICY_COOLDOWN;setPolicyCooldownDisplay(POLICY_COOLDOWN);
        } else {policyCooldownRef.current=200;setPolicyCooldownDisplay(200);}
      }

      // Trigger build vote (slot-gated)
      if(!activeVoteRef.current&&!activePolicyVoteRef.current&&proposalCooldownRef.current===0){
        if(!hasBuildSlots()){
          // No slots left — don't trigger, just log once
          proposalCooldownRef.current=999;setProposalCooldownDisplay(999);
        } else {
          const slate=buildProposalSlate(membersRef.current,builtRef.current,nominationPickRef.current);
          const minP=membersRef.current.length<=2?1:2;
          if(slate.length>=minP){
            const mv=membersRef.current.filter(m=>m.name!=="You").map(m=>({name:m.name,emoji:m.emoji,vote:getMemberVoteFor(m,slate)}));
            setActiveVote({proposals:slate,ticksLeft:VOTE_WINDOW_TICKS,playerVote:null,memberVotes:mv});
            setBuildSlotsUsed(n=>n+1);
            addLog(`🏛️ The assembly gathers — ${slate.length} proposal${slate.length!==1?"s":""} on the table.`);
            proposalCooldownRef.current=PROPOSAL_COOLDOWN;setProposalCooldownDisplay(PROPOSAL_COOLDOWN);
            setNominationPick(null);
          } else {proposalCooldownRef.current=60;setProposalCooldownDisplay(60);}
        }
      }

      // Phase transitions
      const thr=crisisThreshold(membersRef.current.length);
      if(phaseRef.current==="start"){const extra=Object.keys(builtRef.current).filter(id=>id!=="garden"&&id!=="shelter").length;if(extra>=2)setTimeout(()=>{setPhase("firstVote");setCompletedGoals(g=>g.includes("start")?g:[...g,"start"]);setGoalBanner("🌱 The commons takes shape. Now decide together what comes next.");setTimeout(()=>setGoalBanner(null),5000);},600);}
      if(phaseRef.current==="firstVote"&&firstVoteHeldRef.current)setTimeout(()=>{setPhase("grow");setCompletedGoals(g=>g.includes("firstVote")?g:[...g,"firstVote"]);},300);
      if(phaseRef.current==="grow"){const sc=computeScores(membersRef.current,builtRef.current);if(membersRef.current.length>=10&&AFF_KEYS.every(k=>sc[k]>=thr))setTimeout(()=>{setPhase("pressure");setCompletedGoals(g=>g.includes("grow")?g:[...g,"grow"]);setGoalBanner("🌱 The commons grows stronger. The Kingdom takes notice.");setTimeout(()=>setGoalBanner(null),5000);},600);}

      // Crises (biased by season)
      const crisisMult=phaseRef.current==="pressure"?0.6:1;
      if(!crisisRef.current){
        crisisQueueRef.current-=1;
        if(crisisQueueRef.current<=0){
          const ms=membersRef.current;
          const bias=SEASONS[seasonRef.current].crisisBias;
          const pool=bias?[...CRISIS_TEMPLATES,...CRISIS_TEMPLATES.filter(t=>t.id===bias)]:CRISIS_TEMPLATES;
          const tmpl=pool[Math.floor(Math.random()*pool.length)];
          const coinAmt=80+ms.length*30;
          const c2={template:tmpl,ticksLeft:Math.floor(180*crisisMult),totalTicks:Math.floor(180*crisisMult),coins:coinAmt};
          setActiveCrisis(c2);setCrisisWarning(c2);
          // Crisis consumes a build slot
          if(phaseRef.current!=="survival"){
            setBuildSlotsUsed(n=>Math.min(n+1,buildSlotsTotalRef.current));
            addLog(`${tmpl.icon} WARNING: ${tmpl.label} — ${tmpl.warning(coinAmt)} (Assembly slot consumed.)`);
          } else addLog(`${tmpl.icon} WARNING: ${tmpl.label} — ${tmpl.warning(coinAmt)}`);
          setEmergencyPair(EMERGENCY_BUILDINGS[tmpl.id]||null);
          crisisQueueRef.current=Math.floor((700+Math.floor(Math.random()*500))*crisisMult);
        }
      }
      const ac=crisisRef.current;
      if(ac){
        if(ac.ticksLeft<=1){
          const ms0=membersRef.current,b0=builtRef.current,cc=coinsRef.current,wbv=wellbeingRef.current;
          const result=resolveCrisis(ac.template,computeScores(ms0,b0),cc,ms0,wbv);
          addLog(`${result.severity==="none"?"✊":result.severity==="half"?"⚠️":"💀"} ${result.msg}`);
          if(result.coinDelta<0){const hit=Math.abs(result.coinDelta);const fr=Math.min(reserveFundRef.current,hit);const ft=hit-fr;if(fr>0){setReserveFund(r=>Math.max(0,+(r-fr).toFixed(2)));addLog(`🛡️ Reserve absorbed ${Math.floor(fr)} coins.`);}if(ft>0)setCoins(x=>Math.max(0,+(x-ft).toFixed(2)));}
          if(result.wellDelta)adjustWellbeing(result.wellDelta);
          if(result.severity!=="none"){setSolidarityTicks(SOLIDARITY_TICKS);addLog(`🤝 Solidarity rises. XP ×${SOLIDARITY_XP_MULT}.`);}
          if(result.razeBuilding){const keys=Object.keys(b0).filter(k=>!isShelterNode(k)&&nodeIncome(k)>0);if(keys.length){const target=keys[Math.floor(Math.random()*keys.length)];addLog(`🔥 The Kingdom razes ${NODE_INDEX[target]?.node?.name||EM_META[target]?.name||target}.`);setBuilt(prev=>{const n={...prev};delete n[target];return n;});}}
          if(result.loseMember){const pool=ms0.filter(m=>m.name!=="You");if(pool.length){const lost=pool[Math.floor(Math.random()*pool.length)];addLog(`💔 ${lost.emoji} ${lost.name} is taken.`);setMembers(ms0.filter(m=>m!==lost));}}
          setCrisisResult(result);setEmergencyPair(null);setCrisesWeathered(n=>n+1);
          if(ALL_NODES.every(n=>n.id in b0))setCompleteCrises(n=>n+1);
          setActiveCrisis(null);
        } else setActiveCrisis(c=>c?{...c,ticksLeft:c.ticksLeft-1}:c);
      }

      // Neighbor events
      neighborQueueRef.current-=1;
      if(neighborQueueRef.current<=0&&!neighborRef.current){const evt=NEIGHBOR_EVENTS[Math.floor(Math.random()*NEIGHBOR_EVENTS.length)];setNeighborEvent(evt);addLog(`${evt.icon} ${evt.title}: ${evt.desc}`);neighborQueueRef.current=500+Math.floor(Math.random()*600);}

    },TICK_MS);
    return()=>clearInterval(iv);
  },[]);

  // ── ACTIONS ────────────────────────────────────────────────────────────────
  const buildSurvivalNode=id=>{const info=NODE_INDEX[id];if(!info)return;if(!isNodeBuildable(id,built))return;const node=info.node;if(coins<node.cost)return;setCoins(c=>+(c-node.cost).toFixed(2));setBuilt(b=>{const nb={...b,[id]:true};if("garden" in nb&&"shelter" in nb)setTimeout(()=>{setPhase("start");setCompletedGoals(g=>[...g,"survival"]);setGoalBanner("✊ The commons survives the winter. Now build it up.");setTimeout(()=>setGoalBanner(null),5000);},600);return nb;});addLog(`${node.emoji} The commons builds the ${node.name}.`);if(!isShelterNode(id)&&node.path){const used=members.map(m=>m.name);const r=MEMBER_POOL.find(m=>!used.includes(m.name)&&m.affinities[0]===node.path)||MEMBER_POOL.find(m=>!used.includes(m.name));if(r&&!atCapacity(members,{...built,[id]:true}))setMembers(ms=>[...ms,mkMember(r)]);}};
  const buildEmergency=b=>{if(coins<b.cost)return;setCoins(c=>+(c-b.cost).toFixed(2));setBuilt(o=>({...o,[b.id]:true}));addLog(`${b.emoji} Emergency: ${b.name} built.`);setEmergencyPair(null);};

  const callVote=()=>{
    if(!hasBuildSlots()){addLog("No assembly slots remain this season.");return;}
    const slate=buildProposalSlate(membersRef.current,builtRef.current,nominationPick);
    if(!slate.length){addLog("No buildable nodes available.");return;}
    const mv=members.filter(m=>m.name!=="You").map(m=>({name:m.name,emoji:m.emoji,vote:getMemberVoteFor(m,slate)}));
    setActiveVote({proposals:slate,ticksLeft:VOTE_WINDOW_TICKS,playerVote:null,memberVotes:mv});
    setBuildSlotsUsed(n=>n+1);
    proposalCooldownRef.current=PROPOSAL_COOLDOWN;setProposalCooldownDisplay(PROPOSAL_COOLDOWN);
    setNominationPick(null);
    addLog(`🏛️ The assembly gathers — ${slate.length} proposal${slate.length!==1?"s":""} on the table.`);
  };

  const doSpeech=idx=>{if(freedHours<SPEECH_COST)return;setFreedHours(f=>+(f-SPEECH_COST).toFixed(2));setActiveVote(v=>{if(!v)return v;const nm=[...v.memberVotes];let sw=0;for(let i=0;i<nm.length&&sw<2;i++){if(nm[i].vote!==idx&&Math.random()<0.55){nm[i]={...nm[i],vote:idx};sw++;}}addLog(`🗣️ Speech for "${v.proposals[idx]?.node?.name}". ${sw} member${sw!==1?"s":""} moved.`);return{...v,memberVotes:nm};});};
  const doPolicySpeech=idx=>{if(freedHours<SPEECH_COST)return;setFreedHours(f=>+(f-SPEECH_COST).toFixed(2));setActivePolicyVote(v=>{if(!v)return v;const nm=[...v.memberVotes];let sw=0;for(let i=0;i<nm.length&&sw<2;i++){if(nm[i].vote!==idx&&Math.random()<0.55){nm[i]={...nm[i],vote:idx};sw++;}}addLog(`🗣️ Speech for "${v.options[idx]?.label}". ${sw} moved.`);return{...v,memberVotes:nm};});};
  const castPlayerVote=idx=>{setActiveVote(v=>v?{...v,playerVote:idx}:v);addLog(`🗳️ You cast your vote.`);};
  const castPolicyVote=idx=>{setActivePolicyVote(v=>v?{...v,playerVote:idx}:v);addLog(`🗳️ You vote: "${activePolicyVote?.options[idx]?.label}".`);};

  const castTransitionVote=idx=>{setTransitionModal(m=>m?{...m,transitionVote:{...m.transitionVote,playerVote:idx}}:m);};
  const doTransitionSpeech=idx=>{if(freedHours<SPEECH_COST)return;setFreedHours(f=>+(f-SPEECH_COST).toFixed(2));setTransitionModal(m=>{if(!m)return m;const nm=[...m.transitionVote.memberVotes];let sw=0;for(let i=0;i<nm.length&&sw<2;i++){if(nm[i].vote!==idx&&Math.random()<0.55){nm[i]={...nm[i],vote:idx};sw++;}}addLog(`🗣️ Speech for "${m.transitionVote.options[idx]?.label}". ${sw} moved.`);return{...m,transitionVote:{...m.transitionVote,memberVotes:nm}};});};

  const confirmTransition=()=>{
    const tv=transitionModal.transitionVote;
    const tally=tv.options.map(()=>0);
    tv.memberVotes.forEach(mv=>{if(mv.vote!=null)tally[mv.vote]++;});
    if(tv.playerVote!=null)tally[tv.playerVote]++;
    let winner=0;tally.forEach((t,i)=>{if(t>tally[winner])winner=i;});
    const winOpt=tv.options[winner];
    addLog(`🏛️ The commons decides: "${winOpt.label}" for ${transitionModal.incomingLabel}.`);
    applyTransitionEffect(winOpt.effect);
    setTransitionModal(null);
  };

  const openLevelUp=m=>setLevelUpModal({member:m,choices:[...ALL_AFF_KEYS].sort(()=>Math.random()-0.5).slice(0,3)});
  const confirmLevelUp=aff=>{const{member}=levelUpModal;if(coins<LEVEL_UP_COST){addLog(`💸 Need ${LEVEL_UP_COST} coins.`);setLevelUpModal(null);return;}setCoins(c=>+(c-LEVEL_UP_COST).toFixed(2));setMembers(ms=>ms.map(m=>m.name!==member.name?m:{...m,affinities:[...m.affinities,aff],xp:0,level:(m.level||1)+1}));addLog(`⭐ ${member.emoji} ${member.name} grows — gains ${AFF[aff].emoji} ${AFF[aff].label}.`);setLevelUpModal(null);};
  const doTrain=(member,targetAff)=>{const cost=trainCost(false,member.affinities[0],targetAff);if(coins<cost)return;setCoins(c=>+(c-cost).toFixed(2));setMembers(ms=>ms.map(m=>m.name!==member.name?m:{...m,xp:(m.xp||0)+Math.floor(xpThresh(m)*0.65)}));addLog(`📖 ${member.emoji} ${member.name} studies toward ${AFF[targetAff].emoji} ${AFF[targetAff].label} (${cost} coins).`);setTrainModal(null);};
  const confirmRetrain=(member,removeAff,addAff)=>{const cost=trainCost(true,member.affinities[0],addAff);if(coins<cost){addLog(`💸 Need ${cost} coins.`);setRetrainModal(null);setRetrainRemove(null);return;}setCoins(c=>+(c-cost).toFixed(2));setMembers(ms=>ms.map(m=>{if(m.name!==member.name)return m;const idx=m.affinities.lastIndexOf(removeAff);const na=[...m.affinities];if(idx>-1)na.splice(idx,1);na.push(addAff);return{...m,affinities:na};}));addLog(`🔄 ${member.emoji} ${member.name} reskills. (${cost} coins)`);setRetrainModal(null);setRetrainRemove(null);};

  const holdFestival=()=>{if(freedHours<FESTIVAL_COST||solidarityTicks>0)return;setFreedHours(f=>+(f-FESTIVAL_COST).toFixed(2));setSolidarityTicks(SOLIDARITY_TICKS);adjustWellbeing(15);addLog(`🎶 A festival fills the commons.`);};
  const holdTeachIn=()=>{if(freedHours<TEACHIN_COST)return;setFreedHours(f=>+(f-TEACHIN_COST).toFixed(2));setMembers(ms=>{const sc=ms.map(m=>({m,score:m.affinities.length+Object.values(m.depth||{}).reduce((s,d)=>s+d,0)}));const maxS=Math.max(...sc.map(d=>d.score));return ms.map(m=>{const gap=Math.max(0,maxS-(sc.find(d=>d.m===m)?.score||0));return{...m,xp:(m.xp||0)+Math.floor(xpThresh(m)*0.45*(1+gap*0.4))};});});adjustWellbeing(5);addLog(`📚 A teach-in opens.`);};
  const caravanCost=Math.ceil(CARAVAN_BASE*(sisterCommons+1)*caravanDiscount());
  const sendCaravan=()=>{if(freedHours<caravanCost)return;setFreedHours(f=>+(f-caravanCost).toFixed(2));setSisterCommons(s=>s+1);setSolidarityTicks(SOLIDARITY_TICKS);adjustWellbeing(8);addLog(`🤝 A mutual-aid caravan rides out. Sister commons ${sisterCommons+1}/${SISTER_VICTORY}.`);};

  const popCoin =v=>{const id=Date.now()+Math.random(),x=20+Math.random()*30;setCoinPops(p=>[...p,{id,value:v,x}]);setTimeout(()=>setCoinPops(p=>p.filter(q=>q.id!==id)),750);};
  const popFreed=v=>{const id=Date.now()+Math.random(),x=20+Math.random()*30;setFreedPops(p=>[...p,{id,value:v,x}]);setTimeout(()=>setFreedPops(p=>p.filter(q=>q.id!==id)),750);};

  const handleNeighborOption=(option,evt)=>{addLog(`${evt.icon} ${option.label}`);if(option.coinDelta)setCoins(c=>Math.max(0,+(c+option.coinDelta).toFixed(2)));const toAdd=option.key==="all"?evt.members:option.key==="partial"?evt.members.slice(0,1):[];if(toAdd.length){const used=members.map(m=>m.name);const recruits=toAdd.filter(m=>!used.includes(m.name)).map(m=>mkMember(m));if(recruits.length){setMembers(m=>[...m,...recruits]);addLog(`👥 ${recruits.map(r=>`${r.emoji} ${r.name}`).join(", ")} welcomed.`);adjustWellbeing(4);}}setNeighborEvent(null);};

  // ── DERIVED ────────────────────────────────────────────────────────────────
  const scores       = useMemo(()=>computeScores(members,built),[members,built]);
  const thr          = crisisThreshold(members.length);
  const cap          = housingCap(built);
  const houseFull    = atCapacity(members,built);
  const wb           = wellbeingStatus(wellbeing);
  const allBuilt     = useMemo(()=>ALL_NODES.every(n=>n.id in built),[built]);
  const buildableNodes=useMemo(()=>BRANCH_KEYS.flatMap(bk=>{const n=nextNodeInBranch(bk,built);return n?[{...n,branch:bk}]:[];}), [built]);
  const cv=Math.max(2,Math.floor(members.length*(members.reduce((s,m)=>s+(m.level||1),0)/Math.max(members.length,1))+perSec*0.5));
  const fv=Math.max(1,Math.floor(2+members.length*0.6));
  const voteTally=activeVote?activeVote.proposals.map((_,i)=>{let c=activeVote.memberVotes.filter(mv=>mv.vote===i).length;if(activeVote.playerVote===i)c++;return c;}):[]; const policyTally=activePolicyVote?activePolicyVote.options.map((_,i)=>{let c=activePolicyVote.memberVotes.filter(mv=>mv.vote===i).length;if(activePolicyVote.playerVote===i)c++;return c;}):[]; const survivalBuilt=["garden","shelter"].filter(id=>id in built).length;
  const charterLines=useMemo(()=>[{key:"allocation",policy:POLICIES.allocation},{key:"labor",policy:POLICIES.labor},{key:"mutualAid",policy:POLICIES.mutualAid},...(phase==="pressure"?[{key:"crisisDoc",policy:POLICIES.crisisDoc}]:[])].map(({key,policy})=>{const opt=policy.options.find(o=>o.key===charter[key]);return{label:policy.label,emoji:policy.emoji,optLabel:opt?.label||"—"};}),[charter,phase]);
  const slotsRemaining=buildSlotsTotal-buildSlotsUsed;
  const seasonDaysLeft=Math.ceil((SEASON_LENGTH-seasonTick)*TICK_MS/1000/60); // minutes
  const currentSeason=SEASONS[season];

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return(
    <div style={S.app}>
      <style>{`@keyframes floatUp{0%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-46px) scale(1.35)}}@keyframes vicPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}`}</style>
      <div style={S.hdr}><div style={S.h1}>⚔️ GUILD RISING</div></div>

      {goalBanner&&<div style={{background:"linear-gradient(90deg,#1a3010,#2d5020,#1a3010)",borderBottom:"2px solid #60c030",padding:"10px 16px",textAlign:"center",fontSize:15,fontWeight:"bold",color:"#c0f060"}}>{goalBanner}</div>}
      {solidarityTicks>0&&<div style={{background:"linear-gradient(90deg,#10202a,#1a3040,#10202a)",borderBottom:"2px solid #4080c0",padding:"6px 16px",textAlign:"center",fontSize:12,color:"#80c0f0"}}>🤝 Solidarity — XP ×{SOLIDARITY_XP_MULT} ({Math.ceil(solidarityTicks*TICK_MS/1000)}s)</div>}
      {completedGoals.length>0&&<div style={{display:"flex",gap:6,padding:"8px 14px 0",flexWrap:"wrap"}}>{completedGoals.map(g=><div key={g} style={{background:"#0a1a05cc",border:"1px solid #406020",borderRadius:12,padding:"3px 10px",fontSize:11,color:"#80c040"}}>✓ {PHASE_GOALS[g]?.label}</div>)}</div>}

      <div style={S.wrap}>

        {/* ── Resources ── */}
        <div style={S.card}>
          <div style={{display:"flex",gap:10}}>
            <div style={{flex:1,textAlign:"center"}}><div style={{fontSize:10,letterSpacing:1,color:C.dim,textTransform:"uppercase"}}>Treasury</div><div style={{fontSize:26,fontWeight:"bold",color:C.gold}}>🪙 {Math.floor(coins)}</div><div style={{fontSize:10,color:C.tan}}>{perSec>0?`+${perSec.toFixed(1)}/sec`:"\u00a0"}</div></div>
            <div style={{width:1,background:C.border}}/>
            <div style={{flex:1,textAlign:"center"}}><div style={{fontSize:10,letterSpacing:1,color:C.dim,textTransform:"uppercase"}}>Free Time</div><div style={{fontSize:26,fontWeight:"bold",color:"#b080e0"}}>⏳ {Math.floor(freedHours)}</div><div style={{fontSize:10,color:"#9070b0"}}>&nbsp;</div></div>
            {reserveFund>0&&<><div style={{width:1,background:C.border}}/><div style={{flex:1,textAlign:"center"}}><div style={{fontSize:10,letterSpacing:1,color:C.dim,textTransform:"uppercase"}}>Reserve</div><div style={{fontSize:22,fontWeight:"bold",color:"#60a0c0"}}>🛡️ {Math.floor(reserveFund)}</div></div></>}
          </div>
          <div style={{display:"flex",gap:8,marginTop:12,position:"relative"}}>
            <button style={{flex:1,padding:"12px 0",fontSize:14,fontWeight:"bold",borderRadius:10,cursor:"pointer",background:"linear-gradient(180deg,#5a3010,#3a1a08)",border:"2px solid #c08040",color:C.text,transform:coinAnim?"scale(0.97)":"scale(1)"}} onClick={()=>{setCoins(c=>+(c+cv).toFixed(2));popCoin(`+${cv}`);setCoinAnim(true);setTimeout(()=>setCoinAnim(false),100);}}>🤝 Pitch In<br/><span style={{fontSize:11,opacity:0.8}}>+{cv} coins</span></button>
            <button style={{flex:1,padding:"12px 0",fontSize:14,fontWeight:"bold",borderRadius:10,cursor:"pointer",background:"linear-gradient(180deg,#3a1a55,#1f0d33)",border:"2px solid #8050c0",color:"#e0d0f0"}} onClick={()=>{setFreedHours(f=>+(f+fv).toFixed(2));popFreed(`+${fv}`);}}>💜 Free Up<br/><span style={{fontSize:11,opacity:0.8}}>+{fv} hours</span></button>
            {coinPops.map(p=><div key={p.id} style={{position:"absolute",left:`${p.x}%`,top:0,color:C.gold,fontWeight:"bold",fontSize:16,pointerEvents:"none",animation:"floatUp 0.75s ease-out forwards"}}>{p.value}</div>)}
            {freedPops.map(p=><div key={p.id} style={{position:"absolute",left:`${50+p.x}%`,top:0,color:"#c0a0f0",fontWeight:"bold",fontSize:16,pointerEvents:"none",animation:"floatUp 0.75s ease-out forwards"}}>{p.value}</div>)}
          </div>
          <div style={{fontSize:11,color:C.tan,marginTop:8,textAlign:"center"}}>{members.length} member{members.length!==1?"s":""} · 🏚️ <span style={{color:houseFull?"#f06060":C.dim}}>{cap} bed{cap!==1?"s":""}</span></div>
        </div>

        {/* ── Chronicle ── */}
        <div style={S.card}><div style={S.lbl}>Chronicle</div><div style={S.log}>{log.map((l,i)=><div key={i}>{l}</div>)}</div></div>

        {/* ── Season Strip ── */}
        <div style={{...S.card,background:"#0d1a0ecc",border:`1px solid ${currentSeason.icon==="❄️"?"#6080c0":currentSeason.icon==="☀️"?"#c08020":currentSeason.icon==="🌱"?"#408020":"#806030"}55`}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{fontSize:28}}>{currentSeason.icon}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:"bold",color:C.gold}}>{currentSeason.label} · Year {year}</div>
              <div style={{fontSize:10,color:C.dim,marginTop:2}}>
                {(() => {const m=currentSeason;const parts=[];if(m.incomeMult!==1)parts.push(`${m.incomeMult>1?"+":""}${Math.round((m.incomeMult-1)*100)}% income`);if(m.freedMult!==1)parts.push(`${m.freedMult>1?"+":""}${Math.round((m.freedMult-1)*100)}% free time`);if(m.driftMult!==1)parts.push(`${m.driftMult>1?"+":""}${Math.round((m.driftMult-1)*100)}% wellbeing drift`);if(m.crisisBias)parts.push(`${m.crisisBias} likely`);return parts.join(" · ")||"Moderate season";})()}
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:11,color:C.tan,marginBottom:3}}>Assembly slots</div>
              <div style={{display:"flex",gap:4,justifyContent:"flex-end"}}>
                {Array.from({length:buildSlotsTotal}).map((_,i)=><div key={i} style={{width:12,height:12,borderRadius:"50%",background:i<buildSlotsUsed?"#604020":"#a0c060",border:"1px solid #5a3a1a"}}/>)}
              </div>
              <div style={{fontSize:10,color:slotsRemaining===0?"#f06060":C.dim,marginTop:3}}>{slotsRemaining===0?"Adjourned for the season":`${slotsRemaining} slot${slotsRemaining!==1?"s":""} remain`}</div>
            </div>
          </div>
          <div style={{height:4,borderRadius:2,background:"#0a0d05",overflow:"hidden",marginTop:8}}>
            <div style={{height:"100%",width:`${(seasonTick/SEASON_LENGTH)*100}%`,background:"linear-gradient(90deg,#406020,#80c040)",transition:"width 0.5s"}}/>
          </div>
          <div style={{fontSize:10,color:C.dim,marginTop:3,textAlign:"right"}}>{Math.ceil((SEASON_LENGTH-seasonTick)*TICK_MS/1000/60)}min remaining · {SEASONS[currentSeason.next].icon} {SEASONS[currentSeason.next].label} next</div>
        </div>

        {/* ── Scores ── */}
        {phase!=="survival"&&(
          <div style={S.card}>
            <div style={S.lbl}>Commons Scores</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {AFF_KEYS.map(k=>{const pct=Math.min(scores[k]/thr,1);const col=pct>=1?"#80c040":pct>=0.5?"#c09040":"#c04040";return(<div key={k} style={{flex:1,minWidth:0,background:AFF[k].color+"18",border:`1px solid ${AFF[k].color}55`,borderRadius:8,padding:"8px 4px",textAlign:"center"}}><div style={{color:AFF[k].color,fontSize:11}}>{AFF[k].emoji} {AFF[k].scoreLabel}</div><div style={{fontSize:20,fontWeight:"bold",color:col,marginTop:2}}>{Math.round(scores[k]*10)/10}</div><div style={{height:4,borderRadius:2,background:"#1a1005",overflow:"hidden",marginTop:4}}><div style={{height:"100%",width:`${pct*100}%`,background:col,transition:"width 0.4s"}}/></div><div style={{fontSize:9,color:C.dim,marginTop:2}}>need {thr}</div></div>);})}
              <div style={{flex:1.1,minWidth:0,background:wb.color+"1a",border:`1px solid ${wb.color}77`,borderRadius:8,padding:"8px 4px",textAlign:"center"}}><div style={{color:wb.color,fontSize:11}}>💚 Wellbeing</div><div style={{fontSize:14,fontWeight:"bold",color:wb.color,marginTop:3}}>{wb.label}</div><div style={{height:4,borderRadius:2,background:"#1a1005",overflow:"hidden",marginTop:4}}><div style={{height:"100%",width:`${wellbeing}%`,background:wb.color,transition:"width 0.4s"}}/></div><div style={{fontSize:9,color:wb.incMult>=1?C.green:"#f06060",marginTop:2}}>{wb.incMult>=1?`+${Math.round((wb.incMult-1)*100)}%`:`${Math.round((wb.incMult-1)*100)}%`} income</div></div>
            </div>
          </div>
        )}

        {/* ── Goal ── */}
        <div style={S.card}>
          <div style={S.lbl}>Current Goal</div>
          <div style={{fontWeight:"bold",color:C.gold,fontSize:15,marginBottom:4}}>{phase==="pressure"?"👑":phase==="grow"?"🌱":phase==="start"?"🌿":phase==="firstVote"?"🗳️":"❄️"} {PHASE_GOALS[phase]?.label}</div>
          <div style={{fontSize:12,color:C.tan,marginBottom:6}}>{PHASE_GOALS[phase]?.desc}</div>
          {phase==="survival"&&<div style={S.goalBar}><div style={{...S.goalFill,width:`${(survivalBuilt/2)*100}%`}}/></div>}
          {phase==="start"&&<div style={S.goalBar}><div style={{...S.goalFill,width:`${Math.min(Object.keys(built).filter(id=>id!=="garden"&&id!=="shelter").length/2,1)*100}%`}}/></div>}
          {phase==="firstVote"&&<div style={{fontSize:11,color:"#a080e0",marginTop:4}}>⏳ The assembly will convene shortly.</div>}
          {phase==="pressure"&&(<div><div style={{fontSize:11,color:"#f06060",marginTop:4}}>⚠️ Crises arrive faster.</div><div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.dim,marginTop:6}}><span>Crises weathered: <strong style={{color:C.tan}}>{crisesWeathered}</strong></span>{allBuilt?<span style={{color:C.green}}>Endure: {Math.min(completeCrises,VICTORY_CRISES)}/{VICTORY_CRISES}</span>:<span>Complete tree to endure</span>}</div><div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.dim,marginTop:4}}><span>Sister commons</span><span style={{color:sisterCommons>0?"#c0a0f0":"inherit"}}>Spread: {Math.min(sisterCommons,SISTER_VICTORY)}/{SISTER_VICTORY}</span></div></div>)}
        </div>

        {/* ── Crisis ── */}
        {activeCrisis&&(<div style={{background:"#2d050599",border:"2px solid #c04040",borderRadius:10,padding:"12px 14px",marginTop:12}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}><span style={{fontSize:20}}>{activeCrisis.template.icon}</span><div style={{flex:1}}><div style={{fontWeight:"bold",color:"#f06060",fontSize:14}}>{activeCrisis.template.label}</div><div style={{fontSize:11,color:"#c09090"}}>{Math.ceil(activeCrisis.ticksLeft*TICK_MS/1000)}s · score needed: {thr}</div></div></div><div style={{height:8,borderRadius:4,background:"#1a0505",border:"1px solid #602020",overflow:"hidden",marginTop:8}}><div style={{height:"100%",width:`${(activeCrisis.ticksLeft/activeCrisis.totalTicks)*100}%`,transition:"width 0.5s",background:"linear-gradient(90deg,#c04040,#f06020)"}}/></div></div>)}
        {emergencyPair&&activeCrisis&&(<div style={{...S.card,border:"2px solid #c06020"}}><div style={S.lbl}>⚠️ Emergency Build</div><div style={{display:"flex",gap:8,marginTop:8}}>{emergencyPair.map(b=>{const can=coins>=b.cost;return(<div key={b.id} style={{flex:1,background:"#1a0d05cc",border:can?`2px solid ${C.gold}`:`1px solid ${C.border}`,borderRadius:8,padding:"10px",cursor:can?"pointer":"default",opacity:can?1:0.5}} onClick={()=>can&&buildEmergency(b)}><div style={{fontSize:22}}>{b.emoji}</div><div style={{fontWeight:"bold",fontSize:13,color:C.gold}}>{b.name}</div><div style={{fontSize:12,marginTop:4,color:can?C.gold:C.dim}}>🪙 {b.cost}</div></div>);})}</div></div>)}

        {/* ── Survival Build ── */}
        {phase==="survival"&&(<div style={S.card}><div style={S.lbl}>Required Buildings</div>{["garden","shelter"].map(id=>{const node=NODE_INDEX[id].node;const isBuilt=id in built;const can=isNodeBuildable(id,built)&&coins>=node.cost;return(<div key={id} style={{...S.ownedRow,opacity:isBuilt?0.55:1}}><span style={{fontSize:22}}>{node.emoji}</span><div style={{flex:1}}><div style={{fontWeight:"bold",fontSize:13,color:isBuilt?"#60a030":C.gold}}>{node.name}</div><div style={{fontSize:10,color:C.dim}}>{node.desc}</div></div>{isBuilt?<span style={{color:"#60a030"}}>✓</span>:<button style={{fontSize:12,padding:"6px 12px",background:"linear-gradient(180deg,#4a3010,#2d1a05)",border:`2px solid ${C.gold}`,borderRadius:8,color:C.gold,cursor:can?"pointer":"default",opacity:can?1:0.45}} onClick={()=>can&&buildSurvivalNode(id)}>🪙 {node.cost}</button>}</div>);})}
        </div>)}

        {/* ── Assembly ── */}
        {phase!=="survival"&&(
          <div style={{...S.card,border:activeVote||activePolicyVote?"2px solid #8060c0":`1px solid ${C.border}`}}>
            <div style={S.lbl}>🏛️ The Assembly</div>

            {/* Charter */}
            <div style={{marginBottom:12,background:"#0d0803cc",borderRadius:8,padding:"8px 10px",border:`1px solid ${C.border}`}}>
              <div style={{fontSize:10,color:C.dim,letterSpacing:1,textTransform:"uppercase",marginBottom:5}}>Current Charter</div>
              {charterLines.map(cl=>(<div key={cl.label} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,marginBottom:2}}><span>{cl.emoji}</span><span style={{color:C.dim,minWidth:90}}>{cl.label}:</span><span style={{color:C.gold,fontWeight:"bold"}}>{cl.optLabel}</span></div>))}
            </div>

            {/* Priority queue */}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:11,color:C.dim,marginBottom:5,letterSpacing:1,textTransform:"uppercase"}}>Priority Queue</div>
              {priorityQueue.length===0?<div style={{fontSize:12,color:C.dim,fontStyle:"italic",padding:"6px 0"}}>No committed priorities — vote to add one.</div>:priorityQueue.map((item,i)=>{const pct=Math.min(item.funded/item.total,1);const remaining=item.total-item.funded;const pushAmts=[50,200,Math.floor(remaining)].filter((v,idx,arr)=>v>0&&v<=Math.floor(coins)&&arr.indexOf(v)===idx);return(<div key={item.node.id+i} style={{background:i===0?"#1a1005cc":"#0d0803cc",border:i===0?`1px solid ${C.gold}55`:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",marginBottom:6}}><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:16}}>{item.node.emoji}</span><div style={{flex:1}}><div style={{fontSize:12,fontWeight:"bold",color:i===0?C.gold:C.tan}}>{item.node.name}{i===0&&<span style={{fontSize:10,color:"#a0c060",marginLeft:4}}>← building now</span>}</div><div style={{fontSize:10,color:C.dim}}>by {item.proposer}</div></div><div style={{textAlign:"right",fontSize:11,color:C.dim}}>🪙 {Math.floor(item.funded)}/{item.total}</div></div><div style={S.goalBar}><div style={{...S.goalFill,width:`${pct*100}%`}}/></div>{i===0&&<div style={{display:"flex",gap:5,marginTop:7,flexWrap:"wrap"}}>{pushAmts.map(amt=><button key={amt} style={{flex:1,minWidth:50,padding:"5px 6px",background:"linear-gradient(180deg,#3a2808,#1a1005)",border:`1px solid ${C.gold}66`,borderRadius:6,color:C.gold,fontSize:11,cursor:"pointer"}} onClick={()=>{const actual=Math.min(amt,Math.floor(coins),Math.ceil(remaining));if(actual<=0)return;setCoins(c=>+(c-actual).toFixed(2));setPriorityQueue(q=>q.length>0?[{...q[0],funded:Math.min(q[0].funded+actual,q[0].total)},...q.slice(1)]:q);addLog(`🪙 ${actual} coins directed to ${item.node.name}.`);}}>+{amt===Math.floor(remaining)?"all":amt}</button>)}{pushAmts.length===0&&<div style={{fontSize:10,color:C.dim,padding:"4px 0"}}>Not enough in treasury.</div>}</div>}</div>);})}
            </div>

            {/* Nominate + Call Vote */}
            {!activeVote&&!activePolicyVote&&(
              <div style={{marginBottom:10}}>
                {nominationPick?<div style={{display:"flex",alignItems:"center",gap:8,background:"#1a1005cc",border:`1px solid ${C.gold}55`,borderRadius:8,padding:"8px 10px",marginBottom:8}}><span style={{fontSize:16}}>{nominationPick.emoji}</span><div style={{flex:1,fontSize:12,color:C.gold}}>Nominated: <strong>{nominationPick.name}</strong></div><button style={{fontSize:11,padding:"4px 8px",background:"#2a1a05cc",border:`1px solid ${C.border}`,borderRadius:6,color:C.dim,cursor:"pointer"}} onClick={()=>setNominationPick(null)}>× Clear</button></div>
                :<button style={{width:"100%",padding:"9px",background:"linear-gradient(180deg,#2a1a40,#1a0d28)",border:"1px solid #6040a0",borderRadius:8,color:"#c0a0f0",fontSize:13,cursor:"pointer",marginBottom:8}} onClick={()=>setNominating(true)}>📋 Nominate a node for next assembly</button>}
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <button style={{flex:1,padding:"9px",background:slotsRemaining===0?"#1a0d05cc":"linear-gradient(180deg,#1a2a10,#0d1a08)",border:`1px solid ${slotsRemaining===0?"#602020":"#4a8020"}`,borderRadius:8,color:slotsRemaining===0?"#604040":"#a0d060",fontSize:13,cursor:slotsRemaining===0?"default":"pointer"}} onClick={callVote} disabled={slotsRemaining===0}>
                    {slotsRemaining===0?"🚫 Assembly adjourned for the season":"🗳️ Call a Vote"}
                  </button>
                  <div style={{fontSize:10,color:C.dim,textAlign:"right",lineHeight:1.5}}>Auto in ~{Math.ceil(proposalCooldownDisplay*TICK_MS/1000)}s<br/>Policy ~{Math.ceil(policyCooldownDisplay*TICK_MS/1000)}s</div>
                </div>
              </div>
            )}

            {/* Policy vote */}
            {activePolicyVote&&(
              <div style={{background:"#0e0a1ecc",border:"2px solid #6050a0",borderRadius:10,padding:"12px",marginBottom:8}}>
                <div style={{fontWeight:"bold",color:"#b090f0",fontSize:14,marginBottom:2}}>📋 Policy Vote — {POLICIES[activePolicyVote.policyKey]?.label} · {Math.ceil(activePolicyVote.ticksLeft*TICK_MS/1000)}s</div>
                <div style={{fontSize:11,color:C.dim,marginBottom:10}}>Your voice is 1 of {members.length}. Policy track — separate from build assemblies.</div>
                {activePolicyVote.options.map((opt,idx)=>{const isMyVote=activePolicyVote.playerVote===idx;const tc=policyTally[idx]||0;const current=charter[activePolicyVote.policyKey]===opt.key;return(<div key={opt.key} style={{background:isMyVote?"#1a1030cc":"#0d0803cc",border:isMyVote?"2px solid #a080e0":current?`1px solid ${C.gold}55`:`1px solid ${C.border}`,borderRadius:8,padding:"10px",marginBottom:8}}><div style={{fontWeight:"bold",fontSize:13,color:isMyVote?"#c0a0f0":C.gold}}>{opt.label}{current&&<span style={{fontSize:10,color:"#a0c060",marginLeft:6}}>← current</span>}</div><div style={{fontSize:11,color:C.tan,marginTop:2}}>{opt.desc}</div>{opt.prefAff.length>0&&<div style={{fontSize:10,color:C.dim,marginTop:2}}>Preferred by: {opt.prefAff.map(a=>AFF[a]?.emoji).join(" ")}</div>}<div style={{display:"flex",alignItems:"center",gap:6,marginTop:6}}><div style={{flex:1,height:6,borderRadius:3,background:"#1a0d05",overflow:"hidden"}}><div style={{height:"100%",width:`${members.length>0?(tc/members.length)*100:0}%`,background:isMyVote?"#a080e0":"#8060c0",transition:"width 0.4s"}}/></div><span style={{fontSize:11,color:C.tan}}>{tc}/{members.length}</span></div><div style={{display:"flex",gap:6,marginTop:8}}><button disabled={activePolicyVote.playerVote!==null} style={{flex:1,padding:"6px 8px",background:isMyVote?"#3a2060":"linear-gradient(180deg,#3a2060,#1a0d30)",border:`1px solid ${isMyVote?"#a080e0":"#6040a0"}`,borderRadius:6,color:isMyVote?"#c0a0f0":"#9070d0",fontSize:11,cursor:activePolicyVote.playerVote!==null?"default":"pointer",opacity:activePolicyVote.playerVote!==null&&!isMyVote?0.45:1}} onClick={()=>activePolicyVote.playerVote===null&&castPolicyVote(idx)}>{isMyVote?"✓ Your vote":"Vote for this"}</button><button disabled={freedHours<SPEECH_COST} style={{padding:"6px 8px",background:"linear-gradient(180deg,#2a2010,#1a1005)",border:"1px solid #806030",borderRadius:6,color:freedHours>=SPEECH_COST?"#e0c070":C.dim,fontSize:11,cursor:freedHours>=SPEECH_COST?"pointer":"default"}} onClick={()=>doPolicySpeech(idx)}>🗣️ ⏳{SPEECH_COST}</button></div></div>);})}
                {activePolicyVote.playerVote===null&&<div style={{fontSize:11,color:"#f0a060",textAlign:"center",marginTop:4}}>⚠️ You haven't voted yet.</div>}
              </div>
            )}

            {/* Build vote */}
            {activeVote&&(
              <div style={{background:"#120a1ecc",border:"2px solid #8060c0",borderRadius:10,padding:"12px"}}>
                <div style={{fontWeight:"bold",color:"#c0a0f0",fontSize:14,marginBottom:2}}>🗳️ Build Assembly · {Math.ceil(activeVote.ticksLeft*TICK_MS/1000)}s</div>
                <div style={{fontSize:11,color:C.dim,marginBottom:10}}>Your voice is 1 of {members.length}. {slotsRemaining} slot{slotsRemaining!==1?"s":""} remaining after this.</div>
                {activeVote.proposals.map((p,idx)=>{const isMyVote=activeVote.playerVote===idx;const tc=voteTally[idx]||0;return(<div key={p.node.id} style={{background:isMyVote?"#1a1030cc":"#0d0803cc",border:isMyVote?"2px solid #a080e0":`1px solid ${C.border}`,borderRadius:8,padding:"10px",marginBottom:8}}><div style={{display:"flex",alignItems:"flex-start",gap:8}}><span style={{fontSize:20,flexShrink:0}}>{p.node.emoji}</span><div style={{flex:1,minWidth:0}}><div style={{fontWeight:"bold",fontSize:13,color:isMyVote?"#c0a0f0":C.gold}}>{p.node.name}</div><div style={{fontSize:10,color:C.dim}}>🪙 {p.node.cost} · {p.proposerEmoji} {p.proposer}</div><div style={{fontSize:10,color:C.tan,marginTop:2}}>{p.node.desc}</div><div style={{display:"flex",alignItems:"center",gap:6,marginTop:6}}><div style={{flex:1,height:6,borderRadius:3,background:"#1a0d05",overflow:"hidden"}}><div style={{height:"100%",width:`${members.length>0?(tc/members.length)*100:0}%`,background:isMyVote?"#a080e0":"#c0a060",transition:"width 0.4s"}}/></div><span style={{fontSize:11,color:C.tan}}>{tc}/{members.length}</span></div></div></div><div style={{display:"flex",gap:6,marginTop:8}}><button disabled={activeVote.playerVote!==null} style={{flex:1,padding:"6px 8px",background:isMyVote?"#3a2060":"linear-gradient(180deg,#3a2060,#1a0d30)",border:`1px solid ${isMyVote?"#a080e0":"#6040a0"}`,borderRadius:6,color:isMyVote?"#c0a0f0":"#9070d0",fontSize:11,cursor:activeVote.playerVote!==null?"default":"pointer",opacity:activeVote.playerVote!==null&&!isMyVote?0.45:1}} onClick={()=>activeVote.playerVote===null&&castPlayerVote(idx)}>{isMyVote?"✓ Your vote":"Vote for this"}</button><button disabled={freedHours<SPEECH_COST} style={{padding:"6px 8px",background:"linear-gradient(180deg,#2a2010,#1a1005)",border:"1px solid #806030",borderRadius:6,color:freedHours>=SPEECH_COST?"#e0c070":C.dim,fontSize:11,cursor:freedHours>=SPEECH_COST?"pointer":"default"}} onClick={()=>doSpeech(idx)}>🗣️ Speech ⏳{SPEECH_COST}</button></div></div>);})}
                {activeVote.playerVote===null&&<div style={{marginTop:4,fontSize:11,color:"#f0a060",textAlign:"center"}}>⚠️ You haven't voted yet.</div>}
              </div>
            )}
          </div>
        )}

        {/* ── Skill Tree ── */}
        {phase!=="survival"&&(
          <div style={S.card}>
            <div style={S.lbl}>Commons Skill Tree</div>
            <div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap"}}>{BRANCH_KEYS.map(bk=>{const b=TREE[bk];const bc=b.nodes.filter(n=>n.id in built).length;const active=treeBranch===bk;return(<button key={bk} onClick={()=>setTreeBranch(bk)} style={{flex:1,minWidth:58,padding:"6px 4px",borderRadius:6,fontSize:11,cursor:"pointer",border:active?`2px solid ${b.color}`:`1px solid ${C.border}`,background:active?b.color+"22":"#1a0d05cc",color:active?b.color:C.tan}}>{b.emoji}<br/>{b.label}<br/><span style={{fontSize:9,color:C.dim}}>{bc}/{b.nodes.length}</span></button>);})}</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>{TREE[treeBranch].nodes.map(node=>{const isBuilt=node.id in built;const inQueue=priorityQueue.some(i=>i.node.id===node.id);const buildable=isNodeBuildable(node.id,built);const locked=!isBuilt&&!buildable;const aff=node.path?AFF[node.path]:null;return(<div key={node.id} style={{display:"flex",alignItems:"center",gap:8,borderRadius:8,padding:"8px 10px",border:isBuilt?"1px solid #406020":inQueue?`1px solid ${C.gold}77`:buildable?`1px solid ${TREE[treeBranch].color}88`:"1px solid #2a1a08",background:isBuilt?"#0a1505cc":inQueue?"#1a1005cc":locked?"#0a0703cc":"#1a0d05cc",opacity:locked?0.55:1}}><span style={{fontSize:20,flexShrink:0}}>{node.emoji}</span><div style={{flex:1,minWidth:0}}><div style={{fontWeight:"bold",fontSize:12,color:isBuilt?"#80c040":inQueue?C.gold:locked?C.dim:C.gold}}>{node.name}{inQueue&&<span style={{fontSize:10,color:"#c0a040",marginLeft:4}}>← in queue</span>}</div>{aff&&<div style={{fontSize:10,color:aff.color}}>{aff.emoji} {aff.label}</div>}<div style={{fontSize:10,color:C.dim}}>{node.desc}</div><div style={{fontSize:10,marginTop:1}}>{node.income>0&&<span style={{color:C.gold}}>+{node.income}/sec </span>}{node.freed&&<span style={{color:"#b080e0"}}>+{node.freed} free time/sec </span>}{node.houses&&<span style={{color:"#8080c0"}}>houses {node.houses} </span>}</div></div>{isBuilt?<span style={{color:"#60a030",flexShrink:0}}>✓</span>:inQueue?<span style={{fontSize:10,color:C.gold,flexShrink:0}}>📋</span>:locked?<span style={{fontSize:9,color:C.dim,flexShrink:0}}>🔒</span>:<button style={{fontSize:10,padding:"5px 8px",background:"linear-gradient(180deg,#2a1a40,#1a0d28)",border:"1px solid #6040a0",borderRadius:6,color:"#c0a0f0",cursor:"pointer",flexShrink:0}} onClick={()=>setNominationPick(node)}>📋 Nominate</button>}</div>);})}
            </div>
          </div>
        )}

        {/* ── Collective Projects ── */}
        {phase!=="survival"&&(
          <div style={S.card}>
            <div style={S.lbl}>Collective Projects · ⏳ {Math.floor(freedHours)} hours</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {[
                {fn:holdFestival,cost:FESTIVAL_COST,emoji:"🎶",name:"Hold a Festival",desc:`+15 wellbeing, solidarity, XP ×${SOLIDARITY_XP_MULT}.`,blocked:solidarityTicks>0,locked:false,lockedDesc:""},
                {fn:holdTeachIn, cost:TEACHIN_COST, emoji:"📚",name:"Open a Teach-In",desc:"Speeds up members' experience.",blocked:false,locked:false,lockedDesc:""},
                {fn:sendCaravan, cost:caravanCost,  emoji:"🤝",name:`Send Mutual-Aid Caravan (${sisterCommons}/${SISTER_VICTORY})`,desc:`Seed a sister commons. +8 wellbeing.${charter.mutualAid==="outward"?" (Discounted)":""}`,blocked:false,locked:phase!=="pressure",lockedDesc:"Available once you reach Free the Commons."},
              ].map((p,i)=>{const can=freedHours>=p.cost&&!p.blocked&&!p.locked;return(<button key={i} style={{...S.ownedRow,marginBottom:0,width:"100%",textAlign:"left",cursor:can?"pointer":"default",opacity:can?1:0.5,border:can?"1px solid #6a4aa0":"1px solid #304010",background:can?"#160d20cc":"#0d0803cc"}} onClick={()=>can&&p.fn()}><span style={{fontSize:20}}>{p.emoji}</span><div style={{flex:1}}><div style={{fontWeight:"bold",fontSize:12,color:can?"#c0a0f0":C.dim}}>{p.name}</div><div style={{fontSize:10,color:p.blocked?"#80a0c0":C.dim}}>{p.locked?p.lockedDesc:p.blocked?"Already active.":p.desc}</div></div><span style={{fontSize:11,color:can?"#a070d0":C.dim}}>⏳ {p.cost}</span></button>);})}
            </div>
          </div>
        )}

        {/* ── Members ── */}
        <div style={S.card}>
          <div style={S.lbl}>Commons Members</div>
          <div style={{fontSize:10,color:C.dim,marginBottom:6}}>At 3 affinities, growth deepens expertise (○◐◑●). Mentor ★ · Elder ✦</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {members.map((m,i)=>{const pAff=AFF[m.affinities[m.affinities.length-1]||"agrarian"];const atCap=isAtCap(m),ready=isReady(m),elder=isElder(m),mentor=isMentor(m);const showCtrl=phase!=="survival";const voteStatus=activeVote?activeVote.memberVotes.find(mv=>mv.name===m.name):null;const affCnt={};m.affinities.forEach(a=>affCnt[a]=(affCnt[a]||0)+1);const depthDots=atCap?m.affinities.map(a=>({a,dot:["○","◐","◑","●"][Math.min(Math.floor(m.depth?.[a]||0),3)]})):null;return(<div key={i} style={{display:"flex",alignItems:"center",gap:8,background:"#2d1a0acc",border:`1px solid ${pAff.color}55`,borderRadius:8,padding:"8px 10px"}}><span style={{fontSize:18,flexShrink:0}}>{m.emoji}</span><div style={{flex:1,minWidth:0}}><div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}><strong style={{fontSize:12}}>{m.name}</strong><span style={{fontSize:10,color:C.dim}}>{m.title}</span>{mentor&&<span style={{fontSize:10,color:"#f0c060"}}>★ Mentor</span>}{elder&&<span style={{fontSize:10,color:"#c0a0f0"}}>✦ Elder</span>}{voteStatus&&activeVote&&<span style={{fontSize:10,color:"#a080e0",marginLeft:4}}>→ {activeVote.proposals[voteStatus.vote]?.node?.name?.split(" ")[0]||"?"}</span>}</div><div style={{display:"flex",gap:3,flexWrap:"wrap",marginTop:3}}>{Object.entries(affCnt).map(([aff,cnt])=>{const dot=depthDots?.find(d=>d.a===aff)?.dot;return(<span key={aff} style={{color:AFF[aff]?.color||"#888",fontSize:10,background:(AFF[aff]?.color||"#888")+"22",borderRadius:8,padding:"1px 6px"}}>{AFF[aff]?.emoji}{cnt>1?`×${cnt}`:""} {AFF[aff]?.label}{dot?<span style={{marginLeft:2,opacity:0.8}}>{dot}</span>:null}</span>);})}</div>{!atCap&&!ready&&<div style={S.xpBar}><div style={{...S.xpFill,width:`${Math.min((m.xp||0)/xpThresh(m),1)*100}%`}}/></div>}{ready&&<div style={{fontSize:10,color:"#a060f0",marginTop:3}}>⭐ Ready to grow — support with 🪙{LEVEL_UP_COST}</div>}{atCap&&!elder&&<div style={{fontSize:9,color:C.dim,marginTop:2}}>Deepening expertise</div>}{elder&&<div style={{fontSize:9,color:"#c0a0f0",marginTop:2}}>Wisdom flows outward</div>}</div>{showCtrl&&<div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>{!atCap&&ready&&<button style={{fontSize:10,padding:"3px 8px",background:"linear-gradient(180deg,#3a1a60,#1a0830)",border:"1px solid #8040c0",borderRadius:5,color:"#c090f0",cursor:"pointer"}} onClick={()=>openLevelUp(m)}>Support</button>}{!atCap&&!ready&&<button style={{fontSize:10,padding:"3px 8px",background:"linear-gradient(180deg,#2a1a50,#180d30)",border:"1px solid #6040a0",borderRadius:5,color:"#a080e0",cursor:"pointer"}} onClick={()=>setTrainModal(m)}>Study</button>}{atCap&&<button style={{fontSize:10,padding:"3px 8px",background:"linear-gradient(180deg,#1a2a50,#0d1830)",border:"1px solid #4060a0",borderRadius:5,color:"#80a0e0",cursor:"pointer"}} onClick={()=>setRetrainModal(m)}>Reskill</button>}</div>}</div>);})}
          </div>
        </div>

      </div>

      {/* ── SEASON TRANSITION MODAL ── */}
      {transitionModal&&(
        <div style={S.modal}>
          <div style={{...S.mBox,borderColor:transitionModal.step==="outgoing"?"#806030":"#406080",maxWidth:420}}>
            {transitionModal.step==="outgoing"?(
              <>
                <div style={{textAlign:"center",fontSize:28,marginBottom:4}}>{transitionModal.outgoingIcon}</div>
                <div style={S.mTitle}>{transitionModal.outgoingLabel} Passes{transitionModal.isNewYear?` — Year ${year} Ends`:""}</div>
                <div style={{background:"#0d0803cc",borderRadius:8,padding:"10px 12px",marginBottom:12,fontSize:12,color:C.tan}}>
                  {transitionModal.summary.buildsCompleted.length>0?<div style={{marginBottom:6}}>🏗️ Built this season: {transitionModal.summary.buildsCompleted.join(", ")}</div>:<div style={{marginBottom:6,color:C.dim}}>No builds completed this season.</div>}
                  <div>🗳️ Assembly slots used: {transitionModal.summary.slotsUsed}/{transitionModal.summary.slotsTotal}</div>
                </div>
                {transitionModal.voice&&<div style={{fontStyle:"italic",fontSize:12,color:C.tan,textAlign:"center",marginBottom:14}}>"{transitionModal.voice.emoji} {transitionModal.voice.name} {SEASONS[transitionModal.outgoing].ambient[Math.floor(Math.random()*SEASONS[transitionModal.outgoing].ambient.length)]}"</div>}
                <button style={{...S.mBtn,width:"100%",borderColor:"#806030"}} onClick={()=>setTransitionModal(m=>({...m,step:"incoming"}))}>
                  {transitionModal.incomingIcon} See what {transitionModal.incomingLabel} brings →
                </button>
              </>
            ):(
              <>
                <div style={{textAlign:"center",fontSize:28,marginBottom:4}}>{transitionModal.incomingIcon}</div>
                <div style={S.mTitle}>{transitionModal.incomingLabel} Begins{transitionModal.isNewYear?` — Year ${year}`:""}</div>
                <div style={{fontSize:12,color:C.tan,textAlign:"center",marginBottom:10,fontStyle:"italic"}}>{transitionModal.incomingSeason.forecast}</div>
                {/* Forecast */}
                <div style={{background:"#0d0803cc",borderRadius:8,padding:"10px 12px",marginBottom:12,fontSize:11}}>
                  <div style={{color:C.dim,marginBottom:4,letterSpacing:1,textTransform:"uppercase",fontSize:10}}>Season forecast</div>
                  {(()=>{const m=transitionModal.incomingSeason;const lines=[];if(m.incomeMult!==1)lines.push(`${m.incomeMult>1?"📈":"📉"} Income ${m.incomeMult>1?"+":""}${Math.round((m.incomeMult-1)*100)}%`);if(m.freedMult!==1)lines.push(`${m.freedMult>1?"⬆️":"⬇️"} Free time ${m.freedMult>1?"+":""}${Math.round((m.freedMult-1)*100)}%`);if(m.driftMult!==1)lines.push(`${m.driftMult>1?"⚠️":"✅"} Wellbeing drift ${m.driftMult>1?"+":""}${Math.round((m.driftMult-1)*100)}%`);if(m.crisisBias)lines.push(`⚔️ ${m.crisisBias.charAt(0).toUpperCase()+m.crisisBias.slice(1)} crisis likely`);lines.push(`🗳️ ${m.buildSlots} build slot${m.buildSlots!==1?"s":""} · ${m.policyVote?"1 policy vote":"No policy vote"}`);return lines.map((l,i)=><div key={i} style={{color:C.tan,marginBottom:3}}>{l}</div>);})()}
                </div>
                {/* Transition vote */}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:12,fontWeight:"bold",color:C.gold,marginBottom:8}}>{transitionModal.transitionVote.question}</div>
                  {transitionModal.transitionVote.options.map((opt,idx)=>{
                    const isMyVote=transitionModal.transitionVote.playerVote===idx;
                    const tc=transitionModal.transitionVote.memberVotes.filter(mv=>mv.vote===idx).length+(isMyVote?1:0);
                    return(
                      <div key={opt.key} style={{background:isMyVote?"#1a1030cc":"#0d0803cc",border:isMyVote?"2px solid #a080e0":`1px solid ${C.border}`,borderRadius:8,padding:"10px",marginBottom:8}}>
                        <div style={{fontWeight:"bold",fontSize:13,color:isMyVote?"#c0a0f0":C.gold}}>{opt.label}</div>
                        <div style={{fontSize:11,color:C.tan,marginTop:2}}>{opt.desc}</div>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginTop:6}}><div style={{flex:1,height:5,borderRadius:3,background:"#1a0d05",overflow:"hidden"}}><div style={{height:"100%",width:`${members.length>0?(tc/members.length)*100:0}%`,background:isMyVote?"#a080e0":"#c0a060",transition:"width 0.3s"}}/></div><span style={{fontSize:10,color:C.tan}}>{tc}/{members.length}</span></div>
                        <div style={{display:"flex",gap:6,marginTop:7}}>
                          <button disabled={transitionModal.transitionVote.playerVote!==null} style={{flex:1,padding:"5px 8px",background:isMyVote?"#3a2060":"linear-gradient(180deg,#3a2060,#1a0d30)",border:`1px solid ${isMyVote?"#a080e0":"#6040a0"}`,borderRadius:6,color:isMyVote?"#c0a0f0":"#9070d0",fontSize:11,cursor:transitionModal.transitionVote.playerVote!==null?"default":"pointer",opacity:transitionModal.transitionVote.playerVote!==null&&!isMyVote?0.45:1}} onClick={()=>transitionModal.transitionVote.playerVote===null&&castTransitionVote(idx)}>{isMyVote?"✓ Your vote":"Vote for this"}</button>
                          <button disabled={freedHours<SPEECH_COST} style={{padding:"5px 8px",background:"linear-gradient(180deg,#2a2010,#1a1005)",border:"1px solid #806030",borderRadius:6,color:freedHours>=SPEECH_COST?"#e0c070":C.dim,fontSize:10,cursor:freedHours>=SPEECH_COST?"pointer":"default"}} onClick={()=>doTransitionSpeech(idx)}>🗣️ ⏳{SPEECH_COST}</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button style={{...S.mBtn,width:"100%",borderColor:transitionModal.transitionVote.playerVote!==null?"#60a040":"#606060",color:transitionModal.transitionVote.playerVote!==null?"#a0f060":C.dim}} onClick={confirmTransition}>
                  {transitionModal.transitionVote.playerVote===null?"Skip vote and begin the season →":"Confirm and begin the season →"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Standard modals ── */}
      {nominating&&<div style={S.modal}><div style={S.mBox}><div style={S.mTitle}>📋 Nominate a Node</div><div style={S.mText}>Choose what you'll put before the assembly.</div><div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>{buildableNodes.map(node=>(<button key={node.id} style={{...S.mBtn,textAlign:"left",padding:"10px 14px"}} onClick={()=>{setNominationPick(node);setNominating(false);addLog(`👤 You nominate "${node.emoji} ${node.name}".`);}}><div style={{fontWeight:"bold"}}>{node.emoji} {node.name}</div><div style={{fontSize:11,color:C.dim,marginTop:2}}>🪙 {node.cost} · {TREE[node.branch].label}</div><div style={{fontSize:10,color:C.tan,marginTop:1}}>{node.desc}</div></button>))}</div><button style={{...S.mBtn,width:"100%",borderColor:C.dim,color:C.dim}} onClick={()=>setNominating(false)}>Cancel</button></div></div>}
      {crisisWarning&&<div style={S.modal}><div style={{...S.mBox,background:"linear-gradient(160deg,#2d0a0a,#1a0505)",borderColor:"#c04040"}}><div style={{...S.mTitle,color:"#f06060"}}>{crisisWarning.template.icon} {crisisWarning.template.label}</div><div style={S.mText}>{crisisWarning.template.warning(crisisWarning.coins)}<br/><br/><span style={{color:C.dim,fontSize:12}}>Score needed: {thr}. One assembly slot consumed.</span></div><button style={{...S.mBtn,width:"100%"}} onClick={()=>setCrisisWarning(null)}>The commons prepares.</button></div></div>}
      {crisisResult&&<div style={S.modal}><div style={{...S.mBox,background:crisisResult.severity==="none"?"linear-gradient(160deg,#0a2d0a,#051a05)":crisisResult.severity==="half"?"linear-gradient(160deg,#2d200a,#1a1205)":"linear-gradient(160deg,#2d0a0a,#1a0505)",borderColor:crisisResult.severity==="none"?"#40c040":crisisResult.severity==="half"?"#c09040":"#c04040"}}><div style={{...S.mTitle,color:crisisResult.severity==="none"?"#80f080":crisisResult.severity==="half"?"#f0c060":"#f06060",fontSize:22}}>{crisisResult.severity==="none"?"✊":crisisResult.severity==="half"?"⚠️":"💀"} {crisisResult.title}</div><div style={{...S.mText,fontSize:14}}>{crisisResult.msg}</div>{crisisResult.coinDelta<0&&<div style={{textAlign:"center",fontSize:16,color:"#f06060",marginBottom:8}}>Treasury hit: {crisisResult.coinDelta} coins</div>}{crisisResult.wellDelta<0&&<div style={{textAlign:"center",fontSize:13,color:"#f0a060",marginBottom:8}}>💚 Wellbeing: {crisisResult.wellDelta} ({Math.round(wellbeing)}→{Math.max(0,Math.round(wellbeing+crisisResult.wellDelta))})</div>}<button style={{...S.mBtn,width:"100%",borderColor:crisisResult.severity==="none"?"#40c040":crisisResult.severity==="half"?"#c09040":"#c04040"}} onClick={()=>setCrisisResult(null)}>The commons endures.</button></div></div>}
      {policyResult&&<div style={S.modal}><div style={{...S.mBox,background:"linear-gradient(160deg,#0e0a1e,#07050f)",borderColor:"#8060c0"}}><div style={S.mTitle}>📋 Charter Updated</div><div style={{...S.mText,fontSize:14}}>{policyResult.policyLabel}: <strong style={{color:C.gold}}>"{policyResult.winOption.label}"</strong> passes.</div><div style={{textAlign:"center",fontSize:12,color:C.tan,marginBottom:12}}>{policyResult.winOption.desc}</div><button style={{...S.mBtn,width:"100%",borderColor:"#8060c0",color:"#c0a0f0"}} onClick={()=>setPolicyResult(null)}>The commons adapts.</button></div></div>}
      {victory&&<div style={S.modal}><div style={{...S.mBox,background:"linear-gradient(160deg,#0a2d18,#05140a)",borderColor:"#60c060",animation:"vicPulse 2.4s ease-in-out infinite"}}><div style={{...S.mTitle,color:"#a0f0a0",fontSize:24}}>🕊️ {victory.path==="spread"?"The Commons Spreads":"The Free Commons"}</div><div style={{...S.mText,fontSize:14}}>{victory.path==="spread"?"Sister commons rise across the land.":"Word spreads of a commons that cannot be broken."}</div><div style={{display:"flex",justifyContent:"space-around",margin:"4px 0 16px",textAlign:"center",flexWrap:"wrap",gap:8}}><div><div style={{fontSize:22,fontWeight:"bold",color:C.gold}}>{victory.members}</div><div style={{fontSize:10,color:C.dim}}>members</div></div><div><div style={{fontSize:22,fontWeight:"bold",color:C.gold}}>{victory.buildings}</div><div style={{fontSize:10,color:C.dim}}>buildings</div></div><div><div style={{fontSize:22,fontWeight:"bold",color:C.gold}}>{victory.crises}</div><div style={{fontSize:10,color:C.dim}}>crises</div></div></div><button style={{...S.mBtn,width:"100%",borderColor:"#60c060",color:"#a0f0a0"}} onClick={()=>setVictory(null)}>Continue as a free commons</button></div></div>}
      {neighborEvent&&<div style={S.modal}><div style={S.mBox}><div style={S.mTitle}>{neighborEvent.icon} {neighborEvent.title}</div><div style={S.mText}>{neighborEvent.desc}</div><div style={{display:"flex",flexDirection:"column",gap:8}}>{neighborEvent.options.map((opt,i)=><button key={i} style={{...S.mBtn,textAlign:"left"}} onClick={()=>handleNeighborOption(opt,neighborEvent)}><div style={{fontWeight:"bold"}}>{opt.label}</div>{opt.coinDelta?<div style={{fontSize:11,color:"#c0a070",marginTop:2}}>Gift: {opt.coinDelta} coins</div>:null}</button>)}</div></div></div>}
      {levelUpModal&&<div style={S.modal}><div style={S.mBox}><div style={S.mTitle}>⭐ Support {levelUpModal.member.emoji} {levelUpModal.member.name}</div><div style={S.mText}>Ready to grow. Choose a new affinity.<br/><span style={{fontSize:11,color:C.dim}}>Commons commits 🪙{LEVEL_UP_COST}.</span></div><div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>{levelUpModal.choices.map((aff,idx)=>{const cnt=levelUpModal.member.affinities.filter(a=>a===aff).length;const can=coins>=LEVEL_UP_COST;return(<button key={idx} style={{...S.mBtn,flex:1,borderColor:AFF[aff]?.color||"#888",color:AFF[aff]?.color||"#888",textAlign:"center",opacity:can?1:0.45}} onClick={()=>can&&confirmLevelUp(aff)}><div style={{fontSize:20}}>{AFF[aff]?.emoji}</div><div style={{marginTop:4,fontSize:12}}>{AFF[aff]?.label}</div>{cnt>0&&<div style={{fontSize:10,color:C.dim,marginTop:2}}>×{cnt+1} expertise</div>}</button>);})}</div>{coins<LEVEL_UP_COST&&<div style={{textAlign:"center",fontSize:12,color:"#f06060",marginBottom:10}}>Need 🪙{LEVEL_UP_COST} — have {Math.floor(coins)}.</div>}<button style={{...S.mBtn,width:"100%",borderColor:C.dim,color:C.dim}} onClick={()=>setLevelUpModal(null)}>Not yet</button></div></div>}
      {trainModal&&<div style={S.modal}><div style={S.mBox}><div style={S.mTitle}>📖 {trainModal.emoji} {trainModal.name}'s Study</div><div style={S.mText}>Accelerated study toward a new affinity.<br/><span style={{fontSize:11,color:C.dim}}>Adjacent = cheaper. Distant = full cost.</span></div><div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>{ALL_AFF_KEYS.map(aff=>{const cost=trainCost(false,trainModal.affinities[0],aff);const can=coins>=cost;return(<button key={aff} style={{...S.mBtn,textAlign:"left",padding:"10px 14px",borderColor:AFF[aff]?.color||"#888",opacity:can?1:0.45}} onClick={()=>can&&doTrain(trainModal,aff)}><div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:AFF[aff]?.color||"#888"}}>{AFF[aff]?.emoji} {AFF[aff]?.label}</span><span style={{color:C.dim}}>🪙 {cost}</span></div><div style={{fontSize:10,color:C.dim,marginTop:2}}>{(ADJACENT[trainModal.affinities[0]]||[]).includes(aff)?"Adjacent — discounted":"Distant — full cost"}</div></button>);})}</div><button style={{...S.mBtn,width:"100%",borderColor:C.dim,color:C.dim}} onClick={()=>setTrainModal(null)}>Cancel</button></div></div>}
      {retrainModal&&!retrainRemove&&<div style={S.modal}><div style={S.mBox}><div style={S.mTitle}>🔄 Reskill {retrainModal.emoji} {retrainModal.name}</div><div style={S.mText}>Which affinity will they set aside?</div><div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>{retrainModal.affinities.map((aff,i)=>(<button key={i} style={{...S.mBtn,textAlign:"left",padding:"10px 14px",borderColor:AFF[aff]?.color||"#888"}} onClick={()=>setRetrainRemove(aff)}><div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:AFF[aff]?.color||"#888"}}>{AFF[aff]?.emoji} {AFF[aff]?.label}</span><span style={{fontSize:11,color:C.dim}}>set aside →</span></div>{(retrainModal.depth?.[aff]||0)>0&&<div style={{fontSize:10,color:"#f0a060",marginTop:2}}>⚠️ Depth {["○","◐","◑","●"][Math.min(Math.floor(retrainModal.depth[aff]),3)]} — growth will be lost</div>}</button>))}</div><button style={{...S.mBtn,width:"100%",borderColor:C.dim,color:C.dim}} onClick={()=>setRetrainModal(null)}>Cancel</button></div></div>}
      {retrainModal&&retrainRemove&&<div style={S.modal}><div style={S.mBox}><div style={S.mTitle}>🔄 What will {retrainModal.name} learn?</div><div style={S.mText}>Setting aside {AFF[retrainRemove]?.emoji} {AFF[retrainRemove]?.label}.</div><div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>{ALL_AFF_KEYS.map(aff=>{const cost=trainCost(true,retrainModal.affinities[0],aff);const can=coins>=cost;return(<button key={aff} style={{...S.mBtn,textAlign:"left",padding:"10px 14px",borderColor:AFF[aff]?.color||"#888",opacity:can?1:0.45}} onClick={()=>can&&confirmRetrain(retrainModal,retrainRemove,aff)}><div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:AFF[aff]?.color||"#888"}}>{AFF[aff]?.emoji} {AFF[aff]?.label}</span><span style={{color:C.dim}}>🪙 {cost}</span></div></button>);})}</div><button style={{...S.mBtn,width:"100%",borderColor:C.dim,color:C.dim}} onClick={()=>setRetrainRemove(null)}>← Back</button></div></div>}

      <div style={{position:"fixed",bottom:8,right:10,fontSize:10,color:C.dim,opacity:0.6,pointerEvents:"none"}}>v16.0</div>

      {/* Footer */}
      <div style={{textAlign:"center",fontSize:11,color:C.dim,opacity:0.7,padding:"16px 0 4px"}}>
        A <a href="https://permadeathmedia.com" target="_blank" rel="noopener noreferrer" style={{color:"inherit"}}>Permadeath Studio</a> game
      </div>
    </div>
  );
}