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

import { AW, AH, RIV_T, RIV_B, BRIDGE, arenaFor } from '@crown/shared';
import { fitCanvas, rr, shade } from './art';

/**
 * The slice reads `S.trophies` (to pick the arena palette) and assigns the module-level
 * `arenaBG` at the end of buildArenaBG(). Both are declared here so the slice stays untouched.
 *
 * `arenaBG` is exported as a `let` on purpose: ES module live bindings mean render.ts sees
 * the new canvas the moment buildArenaBG() reassigns it, exactly as it saw the prototype's
 * shared global. A getter would have worked too, but the slice writes `arenaBG=cv` verbatim.
 */
let S = { trophies: 0 };
export let arenaBG = null;

export function setArenaTrophies(t) { S = { trophies: t | 0 }; }
export function getArenaBG() { return arenaBG; }

/* ==== BEGIN VERBATIM SLICE — crown-clash.html L1478-L1651 ==== */
function buildArenaBG(){
  const {a}=arenaFor(S.trophies);
  const s=48, cv=document.createElement('canvas'), c=fitCanvas(cv,AW*s,AH*s);
  const W=AW*s,H=AH*s, ry0=RIV_T*s, rh=(RIV_B-RIV_T)*s;
  const g1=a.g1, g2=a.g2;

  /* ---- rumput: checker 2 tile, kontras rendah ---- */
  c.fillStyle=g1; c.fillRect(0,0,W,H);
  c.globalAlpha=.5; c.fillStyle=g2;
  for(let y=0;y<AH;y+=2) for(let x=0;x<AW;x+=2) if(((x/2|0)+(y/2|0))%2) c.fillRect(x*s,y*s,s*2,s*2);
  c.globalAlpha=1;
  /* pita potong rumput halus */
  c.globalAlpha=.055; c.fillStyle='#ffffff';
  for(let y=0;y<AH;y+=3) c.fillRect(0,y*s,W,s*1.5);
  c.globalAlpha=.04;
  for(let x=0;x<AW;x+=3) c.fillRect(x*s,0,s*1.5,H);
  c.globalAlpha=1;

  /* ---- lane: pita rumput lebih terang, bukan bata ---- */
  function lane(x,y0,y1,wid){
    const gx=c.createLinearGradient((x-wid/2)*s,0,(x+wid/2)*s,0);
    gx.addColorStop(0,'rgba(255,255,255,0)'); gx.addColorStop(.5,'rgba(255,255,255,.16)'); gx.addColorStop(1,'rgba(255,255,255,0)');
    c.fillStyle=gx; c.fillRect((x-wid/2)*s,y0*s,wid*s,(y1-y0)*s);
    const dw=wid*.42;
    const gd=c.createLinearGradient((x-dw/2)*s,0,(x+dw/2)*s,0);
    gd.addColorStop(0,'rgba(206,172,116,0)'); gd.addColorStop(.5,'rgba(206,172,116,.55)'); gd.addColorStop(1,'rgba(206,172,116,0)');
    c.fillStyle=gd; c.fillRect((x-dw/2)*s,y0*s,dw*s,(y1-y0)*s);
  }
  BRIDGE.forEach(bx=>{ lane(bx,1.6,RIV_T-.2,2.4); lane(bx,RIV_B+.2,AH-1.6,2.4); });
  /* platform batu di bawah tiap tower */
  function platform(tx,ty,r){
    const px=tx*s, py=ty*s, rw=r*s, rh=r*s*.42;
    c.fillStyle='rgba(0,0,0,.24)'; c.beginPath(); c.ellipse(px,py+rh*.28,rw*1.04,rh*1.05,0,0,6.3); c.fill();
    const pg=c.createLinearGradient(0,py-rh,0,py+rh);
    pg.addColorStop(0,'#c0b4a0'); pg.addColorStop(1,'#7e7362');
    c.fillStyle=pg; c.beginPath(); c.ellipse(px,py,rw,rh,0,0,6.3); c.fill();
    c.strokeStyle='#22140b'; c.lineWidth=3; c.stroke();
    c.strokeStyle='rgba(45,38,26,.38)'; c.lineWidth=2;
    for(let k=0;k<10;k++){ const a2=k/10*6.2832;
      c.beginPath(); c.moveTo(px+Math.cos(a2)*rw*.52,py+Math.sin(a2)*rh*.52);
      c.lineTo(px+Math.cos(a2)*rw*.97,py+Math.sin(a2)*rh*.97); c.stroke(); }
    c.strokeStyle='rgba(255,255,255,.30)'; c.lineWidth=2;
    c.beginPath(); c.ellipse(px,py,rw*.55,rh*.55,0,0,6.3); c.stroke();
    c.fillStyle='rgba(255,255,255,.13)'; c.beginPath(); c.ellipse(px,py-rh*.22,rw*.66,rh*.4,0,0,6.3); c.fill();
  }
  [[3.3,23.4,1.55],[14.7,23.4,1.55],[3.3,6.6,1.55],[14.7,6.6,1.55],[9,27.1,1.95],[9,2.9,1.95]]
    .forEach(p=>platform(p[0],p[1],p[2]));

  /* ---- sungai ---- */
  const rg=c.createLinearGradient(0,ry0,0,ry0+rh);
  rg.addColorStop(0,'#1b4f86'); rg.addColorStop(.18,'#2e86c4'); rg.addColorStop(.5,'#63cdf2');
  rg.addColorStop(.82,'#2e86c4'); rg.addColorStop(1,'#1b4f86');
  c.fillStyle=rg; c.fillRect(0,ry0,W,rh);
  for(let i=0;i<5;i++){
    c.strokeStyle='rgba(255,255,255,'+(.30-i*.045)+')'; c.lineWidth=3.4-i*.45; c.lineCap='round';
    c.beginPath();
    for(let x=0;x<=W;x+=10){ const y=ry0+rh*(.20+i*.15)+Math.sin(x*.028+i*1.6)*4.5; if(!x)c.moveTo(x,y); else c.lineTo(x,y); }
    c.stroke();
  }
  /* tepi rumput menjorok + busa */
  for(const [edge,dir] of [[ry0,-1],[ry0+rh,1]]){
    const wave=x=>edge+Math.sin(x*.019+(dir>0?2.4:0))*5*dir-dir*3;
    c.fillStyle=g2; c.beginPath(); c.moveTo(0,wave(0));
    for(let x=0;x<=W;x+=14) c.lineTo(x,wave(x));
    c.lineTo(W,edge+dir*26); c.lineTo(0,edge+dir*26); c.closePath(); c.fill();
    c.fillStyle='rgba(0,0,0,.18)'; c.beginPath(); c.moveTo(0,wave(0));
    for(let x=0;x<=W;x+=14) c.lineTo(x,wave(x));
    c.lineTo(W,wave(W)+dir*8); for(let x=W;x>=0;x-=14) c.lineTo(x,wave(x)+dir*8);
    c.closePath(); c.fill();
    c.strokeStyle='rgba(255,255,255,.66)'; c.lineWidth=4.5; c.beginPath();
    for(let x=0;x<=W;x+=14){ const y=wave(x)-dir*3; if(!x)c.moveTo(x,y); else c.lineTo(x,y); } c.stroke();
    c.strokeStyle='rgba(255,255,255,.28)'; c.lineWidth=2.2; c.beginPath();
    for(let x=0;x<=W;x+=14){ const y=wave(x)-dir*11; if(!x)c.moveTo(x,y); else c.lineTo(x,y); } c.stroke();
  }

  /* ---- jembatan ---- */
  BRIDGE.forEach(bx=>{
    const w=2.3*s, x0=bx*s-w/2, y0=ry0-.5*s, h=rh+1.0*s;
    c.fillStyle='rgba(0,0,0,.34)'; rr(c,x0+5,y0+9,w,h,7); c.fill();
    const bg=c.createLinearGradient(x0,0,x0+w,0);
    bg.addColorStop(0,'#5e3a17'); bg.addColorStop(.22,'#a87a3e'); bg.addColorStop(.55,'#c19653');
    bg.addColorStop(.82,'#8a5f2c'); bg.addColorStop(1,'#573317');
    c.fillStyle=bg; rr(c,x0,y0,w,h,6); c.fill();
    const planks=Math.round(h/(s*.42));
    for(let i=0;i<planks;i++){
      const py=y0+h*i/planks, ph=h/planks;
      c.fillStyle='rgba(255,240,205,'+(i%2?.10:.03)+')'; c.fillRect(x0+5,py+2.5,w-10,ph-5);
      c.strokeStyle='rgba(48,28,10,.72)'; c.lineWidth=3;
      c.beginPath(); c.moveTo(x0+3,py); c.lineTo(x0+w-3,py); c.stroke();
    }
    c.fillStyle='#472a11'; rr(c,x0-7,y0-3,12,h+6,5); c.fill(); rr(c,x0+w-5,y0-3,12,h+6,5); c.fill();
    c.fillStyle='#2e1a08';
    for(let i=0;i<5;i++){ const py=y0+8+i*(h-16)/4;
      c.beginPath(); c.arc(x0-1,py,3.4,0,6.3); c.arc(x0+w+1,py,3.4,0,6.3); c.fill(); }
    c.strokeStyle='#22140b'; c.lineWidth=3.5; rr(c,x0,y0,w,h,6); c.stroke();
  });

  /* ---- pagar batu + benteng ---- */
  const bw=.75*s;
  function wall(x,y,w2,h2,vert){
    const wg=vert? c.createLinearGradient(x,0,x+w2,0):c.createLinearGradient(0,y,0,y+h2);
    wg.addColorStop(0,'#6d6152'); wg.addColorStop(.42,'#9e9080'); wg.addColorStop(1,'#4d4336');
    c.fillStyle=wg; c.fillRect(x,y,w2,h2);
    c.strokeStyle='rgba(38,32,24,.45)'; c.lineWidth=2;
    const step=bw*.78;
    if(vert){ for(let yy=y;yy<y+h2;yy+=step){ c.beginPath(); c.moveTo(x,yy); c.lineTo(x+w2,yy); c.stroke();
        c.beginPath(); c.moveTo(x+w2/2,yy); c.lineTo(x+w2/2,yy+step); c.stroke(); } }
    else { for(let xx=x;xx<x+w2;xx+=step){ c.beginPath(); c.moveTo(xx,y); c.lineTo(xx,y+h2); c.stroke();
        c.beginPath(); c.moveTo(xx,y+h2/2); c.lineTo(xx+step,y+h2/2); c.stroke(); } }
  }
  wall(0,0,bw,H,1); wall(W-bw,0,bw,H,1); wall(0,0,W,bw,0); wall(0,H-bw,W,bw,0);
  c.fillStyle='#3b332a';
  for(let x=0;x<W;x+=bw*1.5){ c.fillRect(x,0,bw*.75,bw*.30); c.fillRect(x,H-bw*.30,bw*.75,bw*.30); }
  for(let y=0;y<H;y+=bw*1.5){ c.fillRect(0,y,bw*.30,bw*.75); c.fillRect(W-bw*.30,y,bw*.30,bw*.75); }
  c.strokeStyle='#22140b'; c.lineWidth=8; c.strokeRect(4,4,W-8,H-8);
  c.strokeStyle='rgba(0,0,0,.34)'; c.lineWidth=4; c.strokeRect(bw,bw,W-bw*2,H-bw*2);
  /* menara sudut */
  function turret(x,y){
    c.fillStyle='rgba(0,0,0,.30)'; c.beginPath(); c.ellipse(x,y+7,25,9,0,0,6.3); c.fill();
    const tg=c.createLinearGradient(x-24,0,x+24,0);
    tg.addColorStop(0,'#ab9f8d'); tg.addColorStop(.5,'#8d8171'); tg.addColorStop(1,'#5f5546');
    c.fillStyle=tg; c.beginPath(); c.arc(x,y,23,0,6.3); c.fill();
    c.strokeStyle='#22140b'; c.lineWidth=3.4; c.stroke();
    c.fillStyle='#3b332a';
    for(let k=0;k<8;k++){ const a2=k/8*6.2832; c.fillRect(x+Math.cos(a2)*18-3.4,y+Math.sin(a2)*18-3.4,6.8,6.8); }
    c.fillStyle='rgba(255,255,255,.16)'; c.beginPath(); c.ellipse(x-6,y-7,9,5.5,-.5,0,6.3); c.fill();
  }
  turret(bw*.55,bw*.55); turret(W-bw*.55,bw*.55); turret(bw*.55,H-bw*.55); turret(W-bw*.55,H-bw*.55);

  /* ---- dekor: pohon, batu, bunga (posisi fix & simetris) ---- */
  function tree(x,y,sz){
    c.fillStyle='rgba(0,0,0,.26)'; c.beginPath(); c.ellipse(x,y+sz*.82,sz*1.1,sz*.4,0,0,6.3); c.fill();
    c.fillStyle='#5a3a1c'; c.fillRect(x-sz*.13,y+sz*.28,sz*.26,sz*.5);
    c.strokeStyle='#22140b'; c.lineWidth=2.2; c.strokeRect(x-sz*.13,y+sz*.28,sz*.26,sz*.5);
    const cg=c.createLinearGradient(0,y-sz,0,y+sz*.4);
    cg.addColorStop(0,shade(g1,.32)); cg.addColorStop(1,shade(g2,-.36));
    c.fillStyle=cg; c.beginPath();
    c.arc(x,y-sz*.34,sz*.60,0,6.3); c.arc(x-sz*.5,y+sz*.04,sz*.46,0,6.3);
    c.arc(x+sz*.5,y+sz*.04,sz*.46,0,6.3); c.arc(x,y+sz*.10,sz*.52,0,6.3); c.fill();
    c.strokeStyle='#22140b'; c.lineWidth=2.8; c.stroke();
    c.fillStyle='rgba(255,255,255,.20)'; c.beginPath(); c.arc(x-sz*.20,y-sz*.42,sz*.28,0,6.3); c.fill();
  }
  function rock(x,y,r){
    c.fillStyle='rgba(0,0,0,.22)'; c.beginPath(); c.ellipse(x,y+r*.45,r*1.05,r*.38,0,0,6.3); c.fill();
    const rg2=c.createLinearGradient(0,y-r,0,y+r);
    rg2.addColorStop(0,'#bcb5a6'); rg2.addColorStop(1,'#6f6858');
    c.fillStyle=rg2; c.beginPath();
    c.moveTo(x-r,y+r*.4); c.quadraticCurveTo(x-r*1.02,y-r*.42,x-r*.28,y-r*.74);
    c.quadraticCurveTo(x+r*.5,y-r*1.0,x+r*.92,y-r*.1);
    c.quadraticCurveTo(x+r*1.02,y+r*.44,x,y+r*.54); c.closePath(); c.fill();
    c.strokeStyle='#22140b'; c.lineWidth=2.4; c.stroke();
    c.fillStyle='rgba(255,255,255,.18)'; c.beginPath(); c.ellipse(x-r*.28,y-r*.34,r*.34,r*.19,-.4,0,6.3); c.fill();
  }
  const tx0=1.55*s, tx1=W-1.55*s, tsz=.60*s;
  [2.3,4.9,9.6,12.2,17.8,20.4,25.1,27.7].forEach((ty,i)=>{
    tree(tx0,ty*s,tsz*(i%2?1:.85)); tree(tx1,ty*s,tsz*(i%2?.85:1));
  });
  [[2.6,3.7],[15.4,3.7],[2.6,26.3],[15.4,26.3],[1.8,11.1],[16.2,18.9]].forEach(rp=>rock(rp[0]*s,rp[1]*s,.30*s));
  const flow=[[5.9,4.2],[12.1,4.2],[7.4,8.3],[10.6,8.3],[3.0,9.9],[15.0,9.9],[6.6,12.1],[11.4,12.1],
              [3.0,20.1],[15.0,20.1],[7.4,21.7],[10.6,21.7],[5.9,25.8],[12.1,25.8],[9.0,10.4],[9.0,19.6]];
  flow.forEach((f,i)=>{
    const fx=f[0]*s, fy=f[1]*s, pc=(i%3===0)?'#ffb3d1':'#ffffff';
    c.fillStyle=pc;
    for(let k=0;k<5;k++){ const a2=k/5*6.2832;
      c.beginPath(); c.arc(fx+Math.cos(a2)*3.4,fy+Math.sin(a2)*3.4,2.6,0,6.3); c.fill(); }
    c.fillStyle='#ffd24a'; c.beginPath(); c.arc(fx,fy,2.4,0,6.3); c.fill();
  });

  /* ---- vignette ---- */
  const vg2=c.createRadialGradient(W/2,H/2,H*.28,W/2,H/2,H*.74);
  vg2.addColorStop(0,'rgba(0,0,0,0)'); vg2.addColorStop(1,'rgba(0,0,0,.30)');
  c.fillStyle=vg2; c.fillRect(0,0,W,H);
  arenaBG=cv;
}
/* ==== END VERBATIM SLICE ==== */

export { buildArenaBG };
