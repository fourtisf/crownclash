/**
 * Arena backdrop — pre-rendered once per match into an offscreen canvas.
 *
 * Started life as a byte-for-byte slice of reference/crown-clash.html L1478-L1651, and was
 * released from `tools/extract.mjs` when the owner asked for a modernised look — you cannot
 * restyle a file that must stay identical. It is now maintained by hand.
 *
 * The prototype remains the reference for *shape*: proportions, silhouettes and the sticker
 * outline that make the game recognisable are unchanged. What has moved on is lighting,
 * blending and effects. Gameplay constants are untouched and still locked to the prototype by
 * packages/shared/test/data-parity.test.ts.
 *
 * Still @ts-nocheck: this is 500+ lines of dense procedural canvas whose every local is a
 * number. Annotating it would add noise without catching a class of bug that matters here.
 * The typed surface consumers see lives in engine.ts.
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

function buildArenaBG(){
  const {a}=arenaFor(S.trophies);
  const s=48, cv=document.createElement('canvas'), c=fitCanvas(cv,AW*s,AH*s);
  const W=AW*s,H=AH*s, ry0=RIV_T*s, rh=(RIV_B-RIV_T)*s;
  const g1=a.g1, g2=a.g2;

  /*
   * Ground.
   *
   * The prototype filled the field with one flat green, a hard 2-tile checkerboard and two
   * sets of white mowing bands. Flat colour over 70% of the screen is the single biggest
   * reason the game read as dated — a real field has tonal drift, and eyes read that drift as
   * "surface" long before they notice any individual blade of grass.
   *
   * All the scatter below is derived from a hash of its own coordinates rather than
   * Math.random(), so the field is stable: the same arena looks the same every match instead
   * of reshuffling its texture each time you press BATTLE.
   */
  const hash2=(x,y)=>{ const n=Math.sin(x*127.1+y*311.7)*43758.5453; return n-Math.floor(n); };

  c.fillStyle=g1; c.fillRect(0,0,W,H);

  /* Sky light: the far end of the pitch sits deeper in shade than the near end. */
  const sky=c.createLinearGradient(0,0,0,H);
  sky.addColorStop(0,'rgba(255,252,225,.10)');
  sky.addColorStop(.45,'rgba(255,252,225,.02)');
  sky.addColorStop(1,'rgba(10,20,45,.13)');
  c.fillStyle=sky; c.fillRect(0,0,W,H);

  /* Broad tonal patches. Big and soft — this is the layer doing the real work. */
  for(let i=0;i<26;i++){
    const hx=hash2(i*3.1,7.7), hy=hash2(i*5.3,2.9), hr=hash2(i*1.7,9.1);
    const px=hx*W, py=hy*H, pr=(.9+hr*2.6)*s;
    const g=c.createRadialGradient(px,py,0,px,py,pr);
    const dark=hash2(i,i)>.5;
    g.addColorStop(0,dark? 'rgba(28,58,32,.16)':'rgba(190,225,140,.13)');
    g.addColorStop(1,'rgba(0,0,0,0)');
    c.fillStyle=g; c.beginPath(); c.arc(px,py,pr,0,6.2832); c.fill();
  }

  /* Mow bands, now barely there — direction without stripes. */
  c.globalAlpha=.030; c.fillStyle='#ffffff';
  for(let y=0;y<AH;y+=3) c.fillRect(0,y*s,W,s*1.5);
  c.globalAlpha=1;
  /* A whisper of the prototype's checker, for continuity rather than pattern. */
  c.globalAlpha=.10; c.fillStyle=g2;
  for(let y=0;y<AH;y+=2) for(let x=0;x<AW;x+=2) if(((x/2|0)+(y/2|0))%2) c.fillRect(x*s,y*s,s*2,s*2);
  c.globalAlpha=1;

  /* Tufts. Two short strokes each, a lit one over a dark one, so they catch the same key
     light as everything else instead of reading as speckle. */
  const tuftDark=shade(g2,-.42), tuftLite=shade(g1,.30);
  for(let i=0;i<760;i++){
    const tx=hash2(i*1.3,i*2.7)*W, ty=hash2(i*4.1,i*0.9)*H;
    const len=(.13+hash2(i,i*3)*.16)*s, lean=(hash2(i*7,i)-.5)*.6;
    c.strokeStyle=tuftDark; c.lineWidth=Math.max(.8,s*.026); c.lineCap='round';
    c.beginPath(); c.moveTo(tx,ty); c.lineTo(tx+lean*len,ty-len); c.stroke();
    c.strokeStyle=tuftLite; c.lineWidth=Math.max(.6,s*.016);
    c.beginPath(); c.moveTo(tx-len*.22,ty); c.lineTo(tx+lean*len-len*.22,ty-len*.78); c.stroke();
  }

  /*
   * Lanes.
   *
   * Each arena already declares its own `path` colour — Frozen Peak's pale ice, Ember Forge's
   * scorched orange — and the prototype never used any of them, hardwiring one tan gradient
   * instead. That is most of why all seven arenas looked alike. These are worn dirt tracks
   * with irregular trodden edges and scattered grit, tinted per arena.
   */
  function lane(x,y0,y1,wid){
    const path=a.path||'#c9a45f';
    const cx=x*s, top=y0*s, bot=y1*s, half=wid*.32*s/2;
    /* Trodden edge: grass thins before the bare earth starts. */
    const soft=c.createLinearGradient(cx-wid*s/2,0,cx+wid*s/2,0);
    soft.addColorStop(0,'rgba(255,255,255,0)');
    soft.addColorStop(.5,'rgba(255,250,225,.10)');
    soft.addColorStop(1,'rgba(255,255,255,0)');
    c.fillStyle=soft; c.fillRect(cx-wid*s/2,top,wid*s,bot-top);

    /* Bare earth, with a wandering edge rather than a hard rectangle. */
    const edge=(yy,side)=> cx+side*(half*(.82+Math.sin(yy*.021+side*1.9)*.13+Math.sin(yy*.006)*.07));
    c.beginPath();
    c.moveTo(edge(top,-1),top);
    for(let yy=top;yy<=bot;yy+=8) c.lineTo(edge(yy,-1),yy);
    for(let yy=bot;yy>=top;yy-=8) c.lineTo(edge(yy,1),yy);
    c.closePath();
    const pg=c.createLinearGradient(cx-half,0,cx+half,0);
    pg.addColorStop(0,shade(path,-.30));
    pg.addColorStop(.42,shade(path,.10));
    pg.addColorStop(1,shade(path,-.22));
    // Kept well under full opacity: a track is worn grass showing earth through it, not a
    // painted stripe. At .85 the lanes read as tarmac and dominate the whole field.
    c.fillStyle=pg; c.globalAlpha=.52; c.fill(); c.globalAlpha=1;

    /* Grass creeping back in over the edges, so the boundary is ragged rather than drawn. */
    c.save(); c.clip();
    c.strokeStyle=shade(g1,.06); c.lineCap='round';
    for(let i=0;i<90;i++){
      const gy=top+hash2(i*3.7,x*17)*(bot-top);
      const side=hash2(i*2.1,x*5)>.5? 1:-1;
      const gx2=edge(gy,side)-side*hash2(i*9,x)*half*.34;
      const len=(.06+hash2(i*4,x*3)*.09)*s;
      c.lineWidth=Math.max(.7,s*.020); c.globalAlpha=.5;
      c.beginPath(); c.moveTo(gx2,gy); c.lineTo(gx2+(hash2(i,x)-.5)*len,gy-len); c.stroke();
    }
    c.globalAlpha=1; c.restore();

    /* Grit inside the track. */
    c.save(); c.clip();
    for(let i=0;i<150;i++){
      const gy=top+hash2(i*2.3,x*13)* (bot-top);
      const gx2=cx+(hash2(i*5.9,x*7)-.5)*half*1.7;
      c.globalAlpha=.10+hash2(i,x)*.16;
      c.fillStyle=hash2(i*3,x*2)>.5? shade(path,.34):shade(path,-.46);
      const r=(.02+hash2(i*11,x)*.035)*s;
      c.beginPath(); c.arc(gx2,gy,r,0,6.2832); c.fill();
    }
    c.globalAlpha=1; c.restore();
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
  /*
   * Tree.
   *
   * The prototype tinted the canopy straight from the field colours (`shade(g1,.32)` over
   * `shade(g2,-.36)`), which made every tree a slightly lighter version of the grass it stood
   * on — they vanished into the background as grey-green scribbles. These use their own
   * saturated foliage colour, get a cast shadow that leans with the key light, and are built
   * from a dark base pass with lit clumps on top so the canopy has volume instead of an
   * outline.
   */
  function tree(x,y,sz){
    const leafDark='#1f5a2b', leafMid='#2f7d3a', leafLite='#63b356';
    /* Cast shadow, offset down-right away from the upper-left key. */
    c.fillStyle='rgba(6,14,30,.30)';
    c.beginPath(); c.ellipse(x+sz*.16,y+sz*.86,sz*1.05,sz*.34,0,0,6.3); c.fill();
    /* Trunk. */
    const tg=c.createLinearGradient(x-sz*.15,0,x+sz*.15,0);
    tg.addColorStop(0,'#7a5024'); tg.addColorStop(.42,'#5a3a1c'); tg.addColorStop(1,'#3b2410');
    c.fillStyle=tg; c.fillRect(x-sz*.13,y+sz*.24,sz*.26,sz*.56);
    c.strokeStyle='#22140b'; c.lineWidth=2.2; c.strokeRect(x-sz*.13,y+sz*.24,sz*.26,sz*.56);
    /* Canopy silhouette first, so the outline wraps the whole mass. */
    const clumps=[[0,-.34,.62],[-.52,.04,.48],[.52,.04,.48],[0,.12,.54]];
    c.beginPath();
    for(const [dx,dy,r] of clumps) c.arc(x+sz*dx,y+sz*dy,sz*r,0,6.3);
    c.fillStyle=leafDark; c.fill();
    c.strokeStyle='#16200f'; c.lineWidth=2.8; c.stroke();
    /* Lit clumps, each pulled up-left toward the key light. */
    for(const [dx,dy,r] of clumps){
      const g2c=c.createRadialGradient(x+sz*(dx-.18),y+sz*(dy-.22),sz*.04,x+sz*dx,y+sz*dy,sz*r);
      g2c.addColorStop(0,leafLite); g2c.addColorStop(.55,leafMid); g2c.addColorStop(1,'rgba(31,90,43,0)');
      c.fillStyle=g2c; c.beginPath(); c.arc(x+sz*dx,y+sz*dy,sz*r*.96,0,6.3); c.fill();
    }
    /* Specular on the topmost clump. */
    c.fillStyle='rgba(255,252,220,.24)';
    c.beginPath(); c.ellipse(x-sz*.22,y-sz*.50,sz*.26,sz*.17,-.5,0,6.3); c.fill();
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

export { buildArenaBG };
