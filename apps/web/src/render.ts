/**
 * AUTO-GENERATED — DO NOT EDIT BY HAND.
 *
 * The region between the VERBATIM SLICE markers is copied byte-for-byte out of
 * reference/crown-clash.html. Regenerate with `pnpm extract`; `pnpm extract:check`
 * fails the build if it drifts. Edit the prototype, not this file.
 *
 * These files carry @ts-nocheck on purpose: type-annotating them would mean editing the
 * slice, which is exactly what we are preventing. The typed surface lives in engine.ts.
 */
// @ts-nocheck
/* eslint-disable */

import { AW, AH, RIV_B, CARD, clamp, lerp, rnd, dist } from '@crown/shared';
import { towerAlive as simTowerAlive, canDeployAt as simCanDeployAt } from '@crown/shared';
import { Art, rr, ell } from './art';
import { getArenaBG } from './arenaBg';

/**
 * `B` is the battle facade the screen assigns before each frame: the shared sim's state
 * plus the client-only FX collections (parts/floats/rings) and view fields (sc, ghost,
 * selected, shake). Keeping its shape identical to the prototype's `B` is what lets
 * render() below stay a verbatim slice.
 */
let B = null;
let aCtx = null;

export function bindRenderer(battle, ctx) { B = battle; aCtx = ctx; }

/* The prototype read the ambient `B`/`arenaBG` globals; these shims preserve the call
   signatures the slice uses while the real implementations take explicit state. */
const towerAlive = (team, side) => simTowerAlive(B, team, side);
const canDeployAt = (team, x, y, card) => simCanDeployAt(B, team, x, y, card);

/* ==== BEGIN VERBATIM SLICE — crown-clash.html L2060-L2226 ==== */
function unitTopY(u){
  if(u.kind==='tower') return u.y-(u.twKind==='king'?2.35:1.85);
  if(u.kind==='build') return u.y-1.0;
  const sz=(u.card&&u.card.art&&u.card.art.sz)||1;
  return u.y-sz*(u.fly?1.6:1.35);
}
function drawBar(c,sc,x,y,w,pct,team){
  const h=.16*sc, W=w*sc;
  c.fillStyle='rgba(4,8,20,.8)'; rr(c,x*sc-W/2-1.5,y*sc-h/2-1.5,W+3,h+3,3); c.fill();
  c.fillStyle=team===0? '#3f8bff':'#ff5a5a';
  rr(c,x*sc-W/2,y*sc-h/2,Math.max(2,W*clamp(pct,0,1)),h,2); c.fill();
  c.fillStyle='rgba(255,255,255,.28)'; rr(c,x*sc-W/2,y*sc-h/2,Math.max(2,W*clamp(pct,0,1)),h*.4,2); c.fill();
}
function render(){
  const c=aCtx, sc=B.sc; if(!c||!arenaBG) return;
  c.save();
  c.clearRect(0,0,AW*sc,AH*sc);
  if(B.shake>.2) c.translate(rnd(-B.shake,B.shake)*.35,rnd(-B.shake,B.shake)*.35);
  c.drawImage(arenaBG,0,0,AW*sc,AH*sc);

  /* zona deploy */
  if(B.selected>=0&&!B.over){
    const card=CARD[B.hand[B.selected]];
    if(card&&card.t!=='spell'){
      c.fillStyle='rgba(80,220,140,.14)';
      c.fillRect(0,(RIV_B+1.1)*sc,AW*sc,(AH-RIV_B-1.1)*sc);
      if(!towerAlive(1,'L')) c.fillRect(0,8.4*sc,AW/2*sc,(RIV_B+1.1-8.4)*sc);
      if(!towerAlive(1,'R')) c.fillRect(AW/2*sc,8.4*sc,AW/2*sc,(RIV_B+1.1-8.4)*sc);
      c.strokeStyle='rgba(120,255,180,.55)'; c.lineWidth=2; c.setLineDash([9,7]);
      c.beginPath(); c.moveTo(0,(RIV_B+1.1)*sc); c.lineTo(AW*sc,(RIV_B+1.1)*sc); c.stroke(); c.setLineDash([]);
    }
  }
  /* ring spawn */
  for(const r of B.rings){
    const p=r.t/r.dur, rad=(r.r+.5)*(1-p*.35)*sc;
    c.strokeStyle=(r.team===0?'rgba(80,180,255,':'rgba(255,110,110,')+(1-p)+')';
    c.lineWidth=3; c.beginPath(); c.arc(r.x*sc,r.y*sc,rad,0,6.3); c.stroke();
    c.fillStyle=(r.team===0?'rgba(80,180,255,':'rgba(255,110,110,')+((1-p)*.18)+')';
    c.beginPath(); c.arc(r.x*sc,r.y*sc,rad,0,6.3); c.fill();
  }
  /* telegraf spell */
  for(const sp of B.spells){
    if(sp.done) continue;
    const p=sp.t/sp.dur;
    c.strokeStyle='rgba(255,190,90,'+(.4+.4*Math.sin(sp.t*22))+')'; c.lineWidth=3;
    c.beginPath(); c.arc(sp.x*sc,sp.y*sc,sp.card.radius*sc,0,6.3); c.stroke();
    c.fillStyle='rgba(255,150,60,.12)'; c.beginPath(); c.arc(sp.x*sc,sp.y*sc,sp.card.radius*sc,0,6.3); c.fill();
    if(sp.card.id==='meteor'){
      const fy=lerp(-6,sp.y,p), fx=lerp(sp.x+(sp.team===0?4:-4),sp.x,p);
      c.fillStyle='rgba(255,150,60,.55)';
      c.beginPath(); c.moveTo(fx*sc,fy*sc); c.lineTo((fx-(sp.team===0?1.6:-1.6))*sc,(fy-2.2)*sc); c.lineTo((fx+.5)*sc,fy*sc); c.closePath(); c.fill();
      const g=c.createRadialGradient(fx*sc,fy*sc,2,fx*sc,fy*sc,.55*sc);
      g.addColorStop(0,'#fff3b0'); g.addColorStop(.45,'#ff9a2a'); g.addColorStop(1,'rgba(210,50,10,0)');
      c.fillStyle=g; c.beginPath(); c.arc(fx*sc,fy*sc,.55*sc,0,6.3); c.fill();
    }
    if(sp.card.id==='volley'&&p>.45){
      c.strokeStyle='rgba(220,235,255,.8)'; c.lineWidth=2;
      for(let i=0;i<10;i++){ const a=(i/10)*6.3, d2=sp.card.radius*(.2+(i%4)/5);
        const x=sp.x+Math.cos(a)*d2, y=sp.y+Math.sin(a)*d2-(1-p)*7;
        c.beginPath(); c.moveTo(x*sc,y*sc); c.lineTo(x*sc,(y+.5)*sc); c.stroke(); }
    }
  }
  /* entity */
  const list=B.units.filter(u=>!u.dead||u.kind==='tower').slice().sort((a,b)=>a.y-b.y);
  Art.hq=list.length<28;
  for(const u of list){
    if(u.dead&&u.kind==='tower'){
      c.save(); c.translate(u.x*sc,u.y*sc);
      c.fillStyle='rgba(20,26,42,.55)';
      rr(c,-.7*sc,-.75*sc,1.4*sc,.8*sc,.1*sc); c.fill();
      c.fillStyle='rgba(60,70,95,.75)';
      rr(c,-.5*sc,-.55*sc,.4*sc,.55*sc,.06*sc); c.fill();
      rr(c,.14*sc,-.42*sc,.34*sc,.42*sc,.06*sc); c.fill();
      c.restore(); continue;
    }
    c.save(); c.translate(u.x*sc,u.y*sc);
    const dp=u.deploy>0? clamp(u.deploy,0,1):0;
    if(dp>0){ c.globalAlpha=1-dp*.75; c.scale(lerp(1,.55,dp),lerp(1,.55,dp)); }
    if(u.kind==='tower'){
      const _k=u.twKind==='king';
      if(_k&&u.team===1) c.translate(0,.40*sc);
      Art.tower(c,u.twKind,u.team,{s:sc*(_k?1.34:1.46),dmgFlash:u.flash});
    } else {
      if(u.fly){ ell(c,0,.12*sc,u.rad*.85*sc,u.rad*.32*sc,'rgba(0,0,0,.28)'); }
      else ell(c,0,0,u.rad*sc,u.rad*.42*sc,'rgba(0,0,0,.34)');
      c.strokeStyle=u.team===0? 'rgba(70,160,255,.75)':'rgba(255,90,90,.75)';
      c.lineWidth=Math.max(1.5,.045*sc);
      c.beginPath(); c.ellipse(0,0,u.rad*.95*sc,u.rad*.4*sc,0,0,6.3); c.stroke();
      c.save(); if(u.face<0) c.scale(-1,1);
      if(u.flash>0){ c.shadowColor='rgba(255,90,90,.95)'; c.shadowBlur=(Art.hq?14*u.flash:0); }
      Art.unit(c,u.card,{s:sc,t:B.time,walk:u.walk,atk:u.atkAnim});
      c.shadowBlur=0; c.restore();
      if(u.charged){ c.strokeStyle='rgba(255,220,110,.9)'; c.lineWidth=2.5;
        c.beginPath(); c.ellipse(0,0,u.rad*1.15*sc,u.rad*.5*sc,0,0,6.3); c.stroke(); }
      if(u.stun>0){ c.fillStyle='rgba(160,240,255,.8)'; c.font='bold '+(.5*sc)+'px sans-serif'; c.textAlign='center';
        c.fillText('✦',0,(unitTopY(u)-u.y-.25)*sc); }
    }
    c.restore();
    if(dp<=0&&u.hp<u.maxHp||u.kind==='tower'){
      const w=u.kind==='tower'? (u.twKind==='king'?1.5:1.2) : Math.max(.55,u.rad*2.1);
      drawBar(c,sc,u.x,unitTopY(u),w,u.hp/u.maxHp,u.team);
    }
  }
  /* proyektil */
  for(const p of B.projs){
    c.save(); c.translate(p.x*sc,p.y*sc); c.rotate(p.ang||0);
    if(p.kind==='arrow'||p.kind==='spear'){
      c.strokeStyle='#8a5a2f'; c.lineWidth=Math.max(1.5,.06*sc); c.lineCap='round';
      c.beginPath(); c.moveTo(-.3*sc,0); c.lineTo(.2*sc,0); c.stroke();
      c.fillStyle='#e6ecf7'; c.beginPath(); c.moveTo(.3*sc,0); c.lineTo(.12*sc,-.08*sc); c.lineTo(.12*sc,.08*sc); c.closePath(); c.fill();
    } else if(p.kind==='fire'){
      const g=c.createRadialGradient(0,0,1,0,0,.28*sc);
      g.addColorStop(0,'#fff0b0'); g.addColorStop(.4,'#ff9a2a'); g.addColorStop(1,'rgba(210,50,10,0)');
      c.fillStyle=g; c.beginPath(); c.arc(0,0,.28*sc,0,6.3); c.fill();
    } else if(p.kind==='lightning'){
      c.strokeStyle='#8fe8ff'; c.lineWidth=Math.max(2,.09*sc); c.shadowColor='#8fe8ff'; c.shadowBlur=(Art.hq?12:0);
      c.beginPath(); c.moveTo(-.5*sc,0); c.lineTo(-.2*sc,-.12*sc); c.lineTo(.05*sc,.1*sc); c.lineTo(.35*sc,0); c.stroke(); c.shadowBlur=0;
    } else if(p.kind==='spit'){
      c.fillStyle='#9ff0d0'; c.beginPath(); c.ellipse(0,0,.16*sc,.1*sc,0,0,6.3); c.fill();
    } else if(p.kind==='ball'){
      c.fillStyle='#39404f'; c.beginPath(); c.arc(0,0,.15*sc,0,6.3); c.fill();
      c.fillStyle='rgba(255,255,255,.35)'; c.beginPath(); c.arc(-.05*sc,-.05*sc,.05*sc,0,6.3); c.fill();
    } else {
      c.fillStyle='#ffe9a0'; c.beginPath(); c.arc(0,0,.1*sc,0,6.3); c.fill();
    }
    c.restore();
  }
  /* partikel */
  for(const p of B.parts){
    const a=clamp(p.life/p.max,0,1);
    if(p.ring){
      c.strokeStyle=p.c; c.globalAlpha=a*.85; c.lineWidth=Math.max(2,.12*sc*a);
      c.beginPath(); c.arc(p.x*sc,p.y*sc,p.sz*sc*(1.35-a*.35),0,6.3); c.stroke(); c.globalAlpha=1;
    } else if(p.arrow){
      c.strokeStyle=p.c; c.globalAlpha=a; c.lineWidth=2;
      c.beginPath(); c.moveTo(p.x*sc,p.y*sc); c.lineTo(p.x*sc,p.y*sc+.4*sc); c.stroke(); c.globalAlpha=1;
    } else {
      c.fillStyle=p.c; c.globalAlpha=a;
      c.fillRect(p.x*sc-p.sz*sc/2,p.y*sc-p.sz*sc/2,p.sz*sc,p.sz*sc); c.globalAlpha=1;
    }
  }
  /* angka damage */
  c.textAlign='center'; c.font='700 '+Math.max(10,.42*sc)+'px "Trebuchet MS",sans-serif';
  for(const f of B.floats){
    const p=f.t/f.dur;
    c.globalAlpha=1-p*p; c.fillStyle='rgba(0,0,0,.65)';
    c.fillText(f.txt,f.x*sc+1.5,(f.y-p*1.1)*sc+1.5);
    c.fillStyle=f.c; c.fillText(f.txt,f.x*sc,(f.y-p*1.1)*sc); c.globalAlpha=1;
  }
  /* ghost deploy */
  if(B.ghost&&B.selected>=0&&!B.over){
    const card=CARD[B.hand[B.selected]], ok=canDeployAt(0,B.ghost.x,B.ghost.y,card);
    c.save(); c.translate(B.ghost.x*sc,B.ghost.y*sc); c.globalAlpha=.72;
    if(card.t==='spell'){
      c.strokeStyle=ok?'#ffd964':'#ff6a6a'; c.lineWidth=3;
      c.beginPath(); c.arc(0,0,card.radius*sc,0,6.3); c.stroke();
      c.fillStyle=ok?'rgba(255,200,80,.18)':'rgba(255,80,80,.18)';
      c.beginPath(); c.arc(0,0,card.radius*sc,0,6.3); c.fill();
    } else {
      c.strokeStyle=ok?'rgba(120,255,180,.9)':'rgba(255,100,100,.9)'; c.lineWidth=3;
      c.beginPath(); c.ellipse(0,0,(card.rad+.35)*sc,(card.rad+.35)*.45*sc,0,0,6.3); c.stroke();
      if(ok){ c.globalAlpha=.55; Art.unit(c,card,{s:sc,t:B.time,walk:0,atk:0}); }
    }
    c.restore(); c.globalAlpha=1;
  }
  c.restore();
}
/* ==== END VERBATIM SLICE ==== */

export { render, unitTopY, drawBar };
