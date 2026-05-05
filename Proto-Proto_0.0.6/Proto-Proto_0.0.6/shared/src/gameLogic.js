export const TICK_RATE_MS = 25;
export const ARENA = { width: 1280, depth: 900, minAltitude: 60, maxAltitude: 640 };
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export const BOOST = {
  max: 100,
  dashDrainPerTick: 2.4,
  stepCost: 18,
  riseDropCostPerTick: 1.6,
  regenPerTick: 0.92,
  dashSpeed: 22,
  cruiseSpeed: 8.8,
  altitudeSpeed: 9,
  stepDistance: 180,
  friction: 0.82,
  drag: 0.88,
  fallDrag: 0.96,
  gravityPerTick: 1.25,
  maxFallSpeed: 18,
  riseThrustFactor: 0.3,
  dropThrustFactor: 0.68,
  dashDurationMs: 220,
  trackingCutMs: 220,
  overheatDurationMs: 1500,
  cancelWindowMs: 280
};

const PROJECTILE_MAX_TURN_RAD_PER_TICK = (15 * Math.PI) / 180;
const PROJECTILE_LOCK_CONE_RAD = (45 * Math.PI) / 180;

export const MOVE_SET = {
  SHOOT: { name: 'Beam Rifle', damage: 8, cooldownMs: 230, range: 920, projectileSpeed: 24, turnRate: 0.12, hitRadius: 34, isMelee: false },
  SUB_SHOOT: { name: 'Scatter Shot', damage: 10, cooldownMs: 500, range: 9200, redLockRange: 92000, projectileSpeed: 18, turnRate: 0.09, hitRadius: 40, isMelee: false },
  MELEE: { name: 'Beam Saber', damage: 16, cooldownMs: 620, range: 240, magnetismSpeed: 20, isMelee: true },
  HEAVY_MELEE: { name: 'Crush Slash', damage: 22, cooldownMs: 950, range: 270, magnetismSpeed: 25, isMelee: true, heavy: true }
};

export function createFighterState(id, x, z, characterId = 'nova') {
  return { id, characterId, x, z, y: 220, vx: 0, vz: 0, vy: 0, health: 100, facing: 1, boost: BOOST.max, isBoostDashing: false, dashEndsAt: 0, isOverheated: false, overheatUntil: 0, canCancelUntil: 0, lockTargetId: id === 'p1' ? 'p2' : 'p1', trackingCutUntil: 0, actionState: 'idle', lastActionAt: 0, lastActionType: null, comboCount: 0, isKO: false };
}

export function createMatchState() { return { fighters: { p1: createFighterState('p1', 320, 260, 'nova'), p2: createFighterState('p2', 940, 620, 'aegis') }, projectiles: [], tick: 0 }; }
export function getDistance3D(a,b){ return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z); }

export function applyMoveVector(f, move, now=Date.now()){ if(f.isKO||f.isOverheated) return false; const m=Math.hypot(move?.x??0,move?.z??0); if(m<0.1) return false; f.vx=(move.x||0)*BOOST.cruiseSpeed; f.vz=(move.z||0)*BOOST.cruiseSpeed; f.facing=(move.x||0)>=0?1:-1; return true; }
export function applyBoostDash(f, move, now=Date.now()){ if(f.isKO||f.isOverheated) return false; const m=Math.hypot(move?.x??0,move?.z??0); if(m<0.1||f.boost<=0) return false; const a=Math.atan2(move.z,move.x); f.vx=Math.cos(a)*BOOST.dashSpeed; f.vz=Math.sin(a)*BOOST.dashSpeed; f.isBoostDashing=true; f.dashEndsAt=now+BOOST.dashDurationMs; f.actionState='dashing'; f.lastActionAt=now; f.lastActionType='BOOST_DASH'; return true; }
export function applyBoostStep(f, move, now=Date.now()){ if(f.isKO||f.isOverheated||f.boost<BOOST.stepCost) return false; f.isBoostDashing=false; const a=Math.atan2(move?.z??0, move?.x??f.facing); f.x+=Math.cos(a)*BOOST.stepDistance; f.z+=Math.sin(a)*BOOST.stepDistance; f.boost=Math.max(0,f.boost-BOOST.stepCost); f.trackingCutUntil=now+BOOST.trackingCutMs; f.canCancelUntil=now+BOOST.cancelWindowMs; f.actionState='stepping'; f.lastActionAt=now; f.lastActionType='BOOST_STEP'; return true; }
export function applyVerticalThrust(f, dir=0, now=Date.now()){ if(f.isKO||f.isOverheated||dir===0||f.boost<=0) return false; f.isBoostDashing=false; const tf=dir>0?BOOST.riseThrustFactor*0.3:BOOST.dropThrustFactor; f.vy += dir*BOOST.altitudeSpeed*tf; f.boost=Math.max(0,f.boost-BOOST.riseDropCostPerTick); f.actionState=dir>0?'rising':'dropping'; f.canCancelUntil=now+BOOST.cancelWindowMs; return true; }

export function resolveAction(attacker, defender, actionType, now=Date.now(), projectiles=[]){
  const move = MOVE_SET[actionType];
  if(!move||attacker.isKO||defender?.isKO||attacker.isOverheated||!defender) return {applied:false};
  const since=now-attacker.lastActionAt; const canCancel=now<=attacker.canCancelUntil;
  if(!canCancel&&since<move.cooldownMs) return {applied:false, reason:'cooldown'};
  attacker.isBoostDashing=false; attacker.lastActionAt=now; attacker.lastActionType=actionType; attacker.canCancelUntil=now+BOOST.cancelWindowMs;
  if(!move.isMelee){ projectiles.push(createProjectile(attacker,defender,move,now)); attacker.actionState='shooting'; return {applied:true, spawnedProjectile:true}; }
  const d=getDistance3D(attacker,defender); if(d<=move.range*1.75){ const a=Math.atan2(defender.z-attacker.z,defender.x-attacker.x); attacker.vx=Math.cos(a)*move.magnetismSpeed; attacker.vz=Math.sin(a)*move.magnetismSpeed; }
  if(d>move.range) return {applied:false, whiff:true};
  defender.health=clamp(defender.health-move.damage,0,100); defender.isKO=defender.health<=0; attacker.comboCount+=1; attacker.actionState=move.heavy?'heavy-melee':'melee'; return {applied:true,damage:move.damage,isKO:defender.isKO,heavy:!!move.heavy};
}

function createProjectile(attacker, defender, move, now){ const mv=Math.hypot(attacker.vx,attacker.vz); const base=mv>0.2?Math.atan2(attacker.vz,attacker.vx):(attacker.facing>=0?0:Math.PI); const spread=move.name==='Scatter Shot'?(Math.random()-0.5)*0.5:0; const angle=base+spread; const redRange=move.redLockRange??move.range; const canRed=getDistance3D(attacker,defender)<=redRange; return { id:`${attacker.id}-${now}-${Math.random().toString(16).slice(2,8)}`, ownerId:attacker.id,targetId:defender.id,x:attacker.x,y:attacker.y,z:attacker.z,vx:Math.cos(angle)*move.projectileSpeed,vy:0,vz:Math.sin(angle)*move.projectileSpeed,damage:move.damage,turnRate:Math.min(move.turnRate,PROJECTILE_MAX_TURN_RAD_PER_TICK/Math.PI),maxRange:move.range,travelled:0,hitRadius:move.hitRadius,expiresAt:now+3000,isHoming:canRed&&isWithinInitialHomingCone(attacker,defender,base),homingBias:move.name==='Scatter Shot'?(Math.random()-0.5)*1.2:0,homingStrength:move.name==='Scatter Shot'?0.2:1 }; }

export function tickProjectiles(matchState, now=Date.now()){ const {fighters, projectiles}=matchState; const survivors=[]; const hits=[]; for(const p of projectiles){ const t=fighters[p.targetId]; if(!t||t.isKO||now>p.expiresAt) continue; const tx=t.x-p.x,tz=t.z-p.z; if(p.vx*tx+p.vz*tz<=0) p.isHoming=false; if(p.isHoming&&t.trackingCutUntil<=now){ const da=Math.atan2(t.z-p.z,t.x-p.x)+(p.homingBias??0); const ca=Math.atan2(p.vz,p.vx); const delta=wrap(da-ca); const dist=Math.hypot(tx,t.y-p.y,tz); const close=clamp((dist-160)/320,0.12,1); const maxT=PROJECTILE_MAX_TURN_RAD_PER_TICK*close; const strength=p.turnRate*(p.homingStrength??1); const na=ca+clamp(delta*strength,-maxT,maxT); const speed=Math.hypot(p.vx,p.vz); p.vx=Math.cos(na)*speed; p.vz=Math.sin(na)*speed; } p.x+=p.vx;p.y+=p.vy;p.z+=p.vz;p.travelled+=Math.hypot(p.vx,p.vz,p.vy); if(p.travelled>p.maxRange) continue; if(Math.hypot(p.x-t.x,p.y-t.y,p.z-t.z)<=p.hitRadius){ t.health=clamp(t.health-p.damage,0,100); t.isKO=t.health<=0; hits.push({targetId:t.id,damage:p.damage}); continue;} survivors.push(p);} matchState.projectiles=survivors; return hits; }

export function tickFighter(f, now=Date.now()){
  if(f.isOverheated){ f.x=clamp(f.x,80,ARENA.width-80); f.z=clamp(f.z,80,ARENA.depth-80); f.y=clamp(f.y+f.vy,ARENA.minAltitude,ARENA.maxAltitude); f.vy*=BOOST.drag; f.actionState='overheat'; if(now>=f.overheatUntil){ f.isOverheated=false; f.actionState='idle'; f.boost=Math.max(BOOST.max*0.35,f.boost); f.vy=0; } return; }
  if(f.isBoostDashing){ f.boost=Math.max(0,f.boost-BOOST.dashDrainPerTick); if(now>=f.dashEndsAt) f.isBoostDashing=false; if(f.boost<=0){ f.isOverheated=true; f.overheatUntil=now+BOOST.overheatDurationMs; f.isBoostDashing=false; f.vx=0;f.vz=0;f.vy=-2;f.actionState='overheat'; return; }} else { f.boost=Math.min(BOOST.max,f.boost+BOOST.regenPerTick); }
  f.x=clamp(f.x+f.vx,80,ARENA.width-80); f.z=clamp(f.z+f.vz,80,ARENA.depth-80); f.y=clamp(f.y+f.vy,ARENA.minAltitude,ARENA.maxAltitude);
  f.vx*=BOOST.friction; f.vz*=BOOST.friction; f.vy*=f.vy<0?BOOST.fallDrag:BOOST.drag;
  if(f.y<=ARENA.minAltitude) f.vy=Math.max(0,f.vy); else f.vy=Math.max(-BOOST.maxFallSpeed, f.vy-BOOST.gravityPerTick);
  if(Math.abs(f.vx)<0.14) f.vx=0; if(Math.abs(f.vz)<0.14) f.vz=0; if(Math.abs(f.vy)<0.14) f.vy=0;
  if(!f.isBoostDashing&&now>f.canCancelUntil&&!f.actionState.includes('melee')&&f.actionState!=='shooting') f.actionState='idle';
}

export function tickMatch(matchState, now=Date.now()){ tickFighter(matchState.fighters.p1,now); tickFighter(matchState.fighters.p2,now); const hits=tickProjectiles(matchState,now); matchState.tick+=1; return hits; }
export function interpolateSnapshot(prev,next,alpha){ if(!prev||!next) return next??prev??null; const l=(a,b)=>a+(b-a)*alpha; const lf=(a,b)=>({...b,x:l(a.x,b.x),y:l(a.y,b.y),z:l(a.z,b.z)}); const lp=(a,b)=>({...b,x:l(a.x,b.x),y:l(a.y,b.y),z:l(a.z,b.z)}); const pm=new Map((prev.projectiles??[]).map((p)=>[p.id,p])); return {...next,fighters:{p1:lf(prev.fighters.p1,next.fighters.p1),p2:lf(prev.fighters.p2,next.fighters.p2)},projectiles:(next.projectiles??[]).map((p)=>pm.get(p.id)?lp(pm.get(p.id),p):p)}; }
export function createInputBuffer(maxSize=10){ const q=[]; return { push(i){q.push(i); if(q.length>maxSize) q.shift();}, flush(){const d=[...q]; q.length=0; return d;}, size(){return q.length;} }; }
function wrap(a){ while(a<=-Math.PI)a+=Math.PI*2; while(a>Math.PI)a-=Math.PI*2; return a; }
function isWithinInitialHomingCone(attacker, defender, yaw){ const vx=Math.cos(yaw), vz=Math.sin(yaw); const tx=defender.x-attacker.x,ty=defender.y-attacker.y,tz=defender.z-attacker.z; const vm=Math.hypot(vx,vz), tm=Math.hypot(tx,ty,tz); if(vm<0.001||tm<0.001) return true; const dot=clamp((vx*tx+vz*tz)/(vm*tm),-1,1); return Math.acos(dot)<=PROJECTILE_LOCK_CONE_RAD; }
