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

import { clamp } from '@crown/shared';
import { CARD, CHESTS, RARITY } from '@crown/shared';

/* ==== BEGIN VERBATIM SLICE — crown-clash.html L802-L1337 ==== */
function shade(hex,amt){
  if(hex&&hex[0]!=='#'){ const m=/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/.exec(hex);
    if(m){ const f0=v=>clamp(Math.round(amt<0? v*(1+amt) : v+(255-v)*amt),0,255);
      return 'rgb('+f0(+m[1])+','+f0(+m[2])+','+f0(+m[3])+')'; }
    return hex; }
  let h=hex.replace('#',''); if(h.length===3) h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  let r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  const f=v=> clamp(Math.round(amt<0? v*(1+amt) : v+(255-v)*amt),0,255);
  return 'rgb('+f(r)+','+f(g)+','+f(b)+')';
}
function rr(c,x,y,w,h,r){
  c.beginPath();
  c.moveTo(x+r,y); c.lineTo(x+w-r,y); c.quadraticCurveTo(x+w,y,x+w,y+r);
  c.lineTo(x+w,y+h-r); c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  c.lineTo(x+r,y+h); c.quadraticCurveTo(x,y+h,x,y+h-r);
  c.lineTo(x,y+r); c.quadraticCurveTo(x,y,x+r,y); c.closePath();
}
function ell(c,x,y,rx,ry,col){ c.fillStyle=col; c.beginPath(); c.ellipse(x,y,rx,ry,0,0,6.2832); c.fill(); }
function circ(c,x,y,r,col){ c.fillStyle=col; c.beginPath(); c.arc(x,y,r,0,6.2832); c.fill(); }
function limb(c,x1,y1,x2,y2,w,col){ c.strokeStyle=col; c.lineWidth=w; c.lineCap='round'; c.beginPath(); c.moveTo(x1,y1); c.lineTo(x2,y2); c.stroke(); }
function fitCanvas(cv,w,h){
  const dpr=Math.min(window.devicePixelRatio||1,2.5);
  cv.width=Math.max(1,Math.round(w*dpr)); cv.height=Math.max(1,Math.round(h*dpr));
  const c=cv.getContext('2d'); c.setTransform(dpr,0,0,dpr,0,0); return c;
}

const Art={hq:true};
const OL='#2b1a10';
function ols(c,w){ c.strokeStyle=OL; c.lineWidth=w; c.lineJoin='round'; c.lineCap='round'; c.stroke(); }
function vg(c,y0,y1,a,b){ const g=c.createLinearGradient(0,y0,0,y1); g.addColorStop(0,a); g.addColorStop(1,b); return g; }
/* isi path yang sudah dibangun: gradient atas-terang bawah-gelap + outline tebal */
function shp(c,col,lw,top,bot,lift){
  const hh=Math.abs(bot-top)||lw*4;
  c.fillStyle=vg(c,top,bot,shade(col,lift===undefined?.30:lift),shade(col,-.24));
  c.fill(); ols(c,Math.max(.85,Math.min(lw,hh*.17)));
}
function pill(c,x,y,w,h,r,col,lw){ rr(c,x,y,w,h,r); shp(c,col,lw,y,y+h); }
function disc(c,x,y,r,col,lw){ c.beginPath(); c.arc(x,y,r,0,6.2832); shp(c,col,lw,y-r,y+r); }
/* kilau rim di kiri-atas */
function rim(c,x,y,rx,ry,al){ c.fillStyle='rgba(255,255,255,'+(al||.34)+')'; c.beginPath(); c.ellipse(x,y,rx,ry,-.5,0,6.2832); c.fill(); }
function gsh(c,u,sc){ ell(c,0,.035*u,(sc||.30)*u,(sc||.30)*u*.34,'rgba(0,0,0,.32)'); }

/* ---- senjata: pegangan di (0,0), ujung ke -y ---- */
Art.weapon=function(c,kind,u,glow){
  const lw=Math.max(.9,u*.042), steel='#e9eef8', gold='#f7cf4a', wood='#8a5a2f';
  switch(kind){
    case 'sword':
      pill(c,-.05*u,-.02*u,.10*u,.17*u,.04*u,wood,lw);
      pill(c,-.17*u,-.09*u,.34*u,.09*u,.04*u,gold,lw);
      c.beginPath(); c.moveTo(-.085*u,-.08*u); c.lineTo(.085*u,-.08*u); c.lineTo(.055*u,-.55*u); c.lineTo(0,-.66*u); c.lineTo(-.055*u,-.55*u); c.closePath();
      shp(c,steel,lw,-.66*u,-.08*u,.15); break;
    case 'greatsword':
      pill(c,-.06*u,-.02*u,.12*u,.20*u,.05*u,'#3a2c1c',lw);
      pill(c,-.22*u,-.10*u,.44*u,.10*u,.05*u,'#6a5ad0',lw);
      c.beginPath(); c.moveTo(-.13*u,-.09*u); c.lineTo(.13*u,-.09*u); c.lineTo(.085*u,-.66*u); c.lineTo(0,-.82*u); c.lineTo(-.085*u,-.66*u); c.closePath();
      shp(c,glow||'#cbd6ee',lw,-.82*u,-.09*u,.2);
      c.fillStyle='rgba(255,255,255,.5)'; c.beginPath(); c.moveTo(-.045*u,-.14*u); c.lineTo(-.02*u,-.14*u); c.lineTo(-.015*u,-.62*u); c.lineTo(-.045*u,-.6*u); c.closePath(); c.fill(); break;
    case 'twinblade':
      for(const d of [-1,1]){ c.save(); c.rotate(d*.42);
        pill(c,-.035*u,-.02*u,.07*u,.13*u,.03*u,'#241a34',lw);
        c.beginPath(); c.moveTo(-.06*u,-.05*u); c.lineTo(.06*u,-.05*u); c.lineTo(.03*u,-.46*u); c.lineTo(0,-.56*u); c.lineTo(-.03*u,-.46*u); c.closePath();
        shp(c,glow||'#7ff5ea',lw,-.56*u,-.05*u,.3); c.restore(); } break;
    case 'axe':
      pill(c,-.045*u,-.06*u,.09*u,.24*u,.04*u,wood,lw);
      c.beginPath(); c.moveTo(-.03*u,-.30*u); c.quadraticCurveTo(-.34*u,-.44*u,-.26*u,-.60*u);
      c.quadraticCurveTo(-.05*u,-.52*u,0,-.56*u); c.quadraticCurveTo(.05*u,-.52*u,.26*u,-.60*u);
      c.quadraticCurveTo(.34*u,-.44*u,.03*u,-.30*u); c.closePath(); shp(c,steel,lw,-.60*u,-.30*u,.14); break;
    case 'lance': case 'spear':
      pill(c,-.032*u,-.10*u,.064*u,.60*u,.03*u,wood,lw);
      c.beginPath(); c.moveTo(-.085*u,-.56*u); c.lineTo(.085*u,-.56*u); c.lineTo(0,-.82*u); c.closePath();
      shp(c,steel,lw,-.82*u,-.56*u,.16);
      if(kind==='lance'){ c.beginPath(); c.arc(0,-.16*u,.13*u,0,6.2832); shp(c,'#e0b83a',lw,-.29*u,-.03*u); } break;
    case 'dagger':
      pill(c,-.04*u,-.02*u,.08*u,.12*u,.03*u,'#4a3520',lw);
      c.beginPath(); c.moveTo(-.06*u,-.08*u); c.lineTo(.06*u,-.08*u); c.lineTo(.03*u,-.34*u); c.lineTo(0,-.42*u); c.lineTo(-.03*u,-.34*u); c.closePath();
      shp(c,steel,lw,-.42*u,-.08*u,.16); break;
    case 'bow':
      c.beginPath(); c.arc(.02*u,-.30*u,.30*u,-1.25,1.25); c.strokeStyle=OL; c.lineWidth=lw*2.9; c.stroke();
      c.strokeStyle='#a06b34'; c.lineWidth=lw*1.7; c.stroke();
      c.beginPath(); c.moveTo(.02*u+Math.cos(-1.25)*.30*u,-.30*u+Math.sin(-1.25)*.30*u);
      c.lineTo(.02*u+Math.cos(1.25)*.30*u,-.30*u+Math.sin(1.25)*.30*u);
      c.strokeStyle='#efe6d0'; c.lineWidth=lw*.8; c.stroke(); break;
    case 'gun':
      pill(c,-.05*u,-.16*u,.10*u,.22*u,.04*u,'#3d2a18',lw);
      pill(c,-.055*u,-.62*u,.11*u,.48*u,.045*u,'#4a5468',lw);
      pill(c,-.10*u,-.68*u,.20*u,.10*u,.04*u,'#2f3646',lw); break;
    case 'staff':
      pill(c,-.038*u,-.06*u,.076*u,.62*u,.035*u,'#6b4726',lw);
      disc(c,0,-.70*u,.15*u,glow||'#ff9a3a',lw);
      c.fillStyle='rgba(255,255,255,.55)'; c.beginPath(); c.arc(-.05*u,-.75*u,.05*u,0,6.2832); c.fill(); break;
    case 'fist':
      disc(c,0,-.14*u,.17*u,'#e8b98a',lw*1.1); break;
  }
};

/* ---- wajah chibi ---- */
function face(c,u,cx,cy,r,opt){
  opt=opt||{};
  const ey=cy+r*.10, ex=r*.36, lw=Math.max(1,u*.055);
  if(opt.glow){ c.fillStyle=opt.glow; c.shadowColor=opt.glow; c.shadowBlur=Art.hq?u*.28:0;
    c.beginPath(); c.ellipse(cx-ex,ey,r*.20,r*.13,0,0,6.3); c.ellipse(cx+ex,ey,r*.20,r*.13,0,0,6.3); c.fill(); c.shadowBlur=0; return; }
  c.fillStyle=OL;
  c.beginPath(); c.ellipse(cx-ex,ey,r*.155,r*.215,0,0,6.3); c.fill();
  c.beginPath(); c.ellipse(cx+ex,ey,r*.155,r*.215,0,0,6.3); c.fill();
  c.fillStyle='rgba(255,255,255,.9)';
  c.beginPath(); c.arc(cx-ex-r*.05,ey-r*.08,r*.055,0,6.3); c.fill();
  c.beginPath(); c.arc(cx+ex-r*.05,ey-r*.08,r*.055,0,6.3); c.fill();
  if(opt.brow!==false){ c.strokeStyle=OL; c.lineWidth=lw*1.1; c.lineCap='round';
    c.beginPath(); c.moveTo(cx-ex-r*.20,ey-r*.42); c.lineTo(cx-ex+r*.16,ey-r*.28); c.stroke();
    c.beginPath(); c.moveTo(cx+ex+r*.20,ey-r*.42); c.lineTo(cx+ex-r*.16,ey-r*.28); c.stroke(); }
  if(opt.mouth!==false){ c.strokeStyle=OL; c.lineWidth=lw*.9;
    c.beginPath(); c.arc(cx,ey+r*.30,r*.20,.35,Math.PI-.35); c.stroke(); }
}

/* ---- HUMANOID chibi (kepala besar, tangan besar, kaki pendek) ---- */
Art.humanoid=function(c,a,o,u){
  const t=o.t,walk=o.walk,atk=o.atk||0;
  const lw=Math.max(1.0,u*.052);
  const skin=a.skin||'#f6c9a0', cloth=a.cloth||'#3f6fd0', armor=a.armor||'#cfd9ea';
  const sw=walk? Math.sin(t*10)*.085*u : 0;
  const bob=walk? Math.abs(Math.sin(t*10))*.028*u : Math.sin(t*2.2)*.012*u;
  const arm=atk>0? Math.sin(atk*Math.PI)*1.65 : 0;
  gsh(c,u,.30);
  c.save(); c.translate(0,-bob);
  /* cape di belakang */
  if(a.cape){ c.beginPath(); c.moveTo(-.20*u,-.66*u); c.quadraticCurveTo(-.34*u,-.30*u,-.24*u,-.05*u);
    c.lineTo(.24*u,-.05*u); c.quadraticCurveTo(.34*u,-.30*u,.20*u,-.66*u); c.closePath(); shp(c,a.cape,lw,-.66*u,-.05*u); }
  /* kaki */
  for(const d of [-1,1]){ const x=d*.115*u, o2=d>0? sw:-sw;
    c.beginPath(); rr(c,x-.085*u,-.34*u,.17*u,.24*u+o2*.4,.07*u); shp(c,shade(cloth,-.12),lw,-.34*u,-.06*u);
    c.beginPath(); rr(c,x-.105*u,-.13*u+o2*.4,.21*u,.16*u,.07*u); shp(c,'#6f4c28',lw,-.13*u,.03*u); }
  /* badan */
  c.beginPath(); rr(c,-.235*u,-.705*u,.47*u,.385*u,.13*u); shp(c,armor,lw,-.705*u,-.32*u);
  c.beginPath(); rr(c,-.235*u,-.44*u,.47*u,.10*u,.04*u); shp(c,'#7a5a2e',lw,-.44*u,-.34*u);
  c.beginPath(); rr(c,-.055*u,-.42*u,.11*u,.07*u,.02*u); shp(c,'#f0c23a',lw*.7,-.42*u,-.35*u);
  if(a.emblem!==false){ c.fillStyle='rgba(255,255,255,.16)'; c.beginPath(); c.ellipse(-.07*u,-.60*u,.07*u,.11*u,-.25,0,6.3); c.fill(); }
  /* lengan kiri + perisai */
  c.save(); c.translate(-.22*u,-.62*u); c.rotate(walk? Math.sin(t*10)*.28 : .12);
  c.beginPath(); rr(c,-.075*u,0,.15*u,.28*u,.07*u); shp(c,cloth,lw,0,.28*u);
  if(a.shield){ c.save(); c.translate(-.05*u,.26*u);
    c.beginPath(); c.moveTo(-.17*u,-.19*u); c.lineTo(.17*u,-.19*u); c.lineTo(.17*u,.10*u);
    c.quadraticCurveTo(0,.30*u,-.17*u,.10*u); c.closePath(); shp(c,'#dfe6f2',lw,-.19*u,.30*u);
    c.beginPath(); c.moveTo(-.09*u,-.11*u); c.lineTo(.09*u,-.11*u); c.lineTo(.09*u,.05*u);
    c.quadraticCurveTo(0,.17*u,-.09*u,.05*u); c.closePath(); shp(c,cloth,lw*.7,-.11*u,.17*u); c.restore(); }
  else disc(c,0,.30*u,.095*u,skin,lw);
  c.restore();
  /* pundak */
  disc(c,-.245*u,-.665*u,.125*u,shade(armor,-.06),lw);
  disc(c, .245*u,-.665*u,.125*u,shade(armor,-.06),lw);
  /* lengan kanan + senjata */
  c.save(); c.translate(.22*u,-.62*u); c.rotate(-.15-arm);
  c.beginPath(); rr(c,-.075*u,0,.15*u,.28*u,.07*u); shp(c,cloth,lw,0,.28*u);
  disc(c,0,.30*u,.095*u,skin,lw);
  if(a.weapon){ c.save(); c.translate(0,.30*u); c.rotate(-.30); Art.weapon(c,a.weapon,u,a.glow); c.restore(); }
  c.restore();
  /* kepala */
  const hy=-.905*u, hr=.245*u;
  disc(c,0,hy,hr,skin,lw);
  rim(c,-.085*u,hy-.09*u,.075*u,.055*u,.30);
  face(c,u,0,hy,hr,{glow:a.glow&&a.skin&&a.skin[1]==='3'?a.glow:null});
  if(a.beard){ c.beginPath(); c.moveTo(-hr*.86,hy+hr*.10); c.quadraticCurveTo(-hr*.6,hy+hr*1.5,0,hy+hr*1.55);
    c.quadraticCurveTo(hr*.6,hy+hr*1.5,hr*.86,hy+hr*.10); c.quadraticCurveTo(0,hy+hr*.62,-hr*.86,hy+hr*.10); c.closePath(); shp(c,a.beard,lw,hy,hy+hr*1.6); }
  if(a.hair&&!a.helm&&!a.hat){ c.beginPath(); c.arc(0,hy,hr*1.03,Math.PI*1.03,Math.PI*1.97); c.closePath(); shp(c,a.hair,lw,hy-hr,hy);
    c.beginPath(); rr(c,-hr*1.05,hy-hr*.32,hr*.34,hr*1.0,hr*.16); shp(c,a.hair,lw,hy-hr*.32,hy+hr*.7);
    c.beginPath(); rr(c,hr*.71,hy-hr*.32,hr*.34,hr*1.0,hr*.16); shp(c,a.hair,lw,hy-hr*.32,hy+hr*.7); }
  if(a.helm){ c.beginPath(); c.arc(0,hy-hr*.08,hr*1.06,Math.PI*.98,Math.PI*2.02); c.lineTo(hr*1.06,hy-hr*.02); c.lineTo(-hr*1.06,hy-hr*.02); c.closePath();
    shp(c,armor,lw,hy-hr*1.2,hy);
    c.beginPath(); rr(c,-hr*.13,hy-hr*.4,hr*.26,hr*1.05,hr*.10); shp(c,shade(armor,-.12),lw*.8,hy-hr*.4,hy+hr*.65);
    rim(c,-hr*.42,hy-hr*.72,hr*.30,hr*.16,.42);
    c.beginPath(); rr(c,-hr*.10,hy-hr*1.62,hr*.20,hr*.5,hr*.08); shp(c,cloth,lw*.8,hy-hr*1.62,hy-hr*1.1); }
  if(a.hat===1){ c.beginPath(); c.ellipse(0,hy-hr*.72,hr*1.45,hr*.34,0,0,6.3); shp(c,a.hatc||'#4a3520',lw,hy-hr,hy-hr*.4);
    c.beginPath(); rr(c,-hr*.62,hy-hr*1.62,hr*1.24,hr*.98,hr*.22); shp(c,a.hatc||'#4a3520',lw,hy-hr*1.62,hy-hr*.64); }
  if(a.hat===2){ c.beginPath(); c.moveTo(-hr*1.12,hy-hr*.62); c.lineTo(hr*1.12,hy-hr*.62); c.lineTo(hr*.18,hy-hr*2.35); c.quadraticCurveTo(0,hy-hr*2.6,-hr*.22,hy-hr*2.25); c.closePath();
    shp(c,a.cloth,lw,hy-hr*2.6,hy-hr*.62);
    c.beginPath(); c.ellipse(0,hy-hr*.62,hr*1.16,hr*.26,0,0,6.3); shp(c,shade(a.cloth,-.2),lw,hy-hr*.9,hy-hr*.35);
    disc(c,-hr*.12,hy-hr*2.42,hr*.15,a.glow||'#ffd24a',lw*.8); }
  c.restore();
};

/* ---- GOBLIN ---- */
Art.goblin=function(c,a,o,u){
  const t=o.t,lw=Math.max(1.1,u*.075),skin=a.skin||'#7ad84f',cloth=a.cloth||'#c94b2b';
  const sw=o.walk? Math.sin(t*13)*.075*u:0, bob=o.walk? Math.abs(Math.sin(t*13))*.03*u:0;
  const arm=o.atk>0? Math.sin(o.atk*Math.PI)*1.7:0;
  gsh(c,u,.26); c.save(); c.translate(0,-bob);
  for(const d of [-1,1]){ const x=d*.10*u,o2=d>0?sw:-sw;
    c.beginPath(); rr(c,x-.075*u,-.30*u,.15*u,.22*u+o2*.4,.06*u); shp(c,skin,lw,-.30*u,-.06*u);
    c.beginPath(); rr(c,x-.09*u,-.11*u+o2*.4,.18*u,.14*u,.06*u); shp(c,'#6f4c28',lw,-.11*u,.03*u); }
  c.beginPath(); rr(c,-.20*u,-.62*u,.40*u,.34*u,.13*u); shp(c,cloth,lw,-.62*u,-.28*u);
  c.beginPath(); rr(c,-.21*u,-.42*u,.42*u,.08*u,.03*u); shp(c,'#7a5a2e',lw,-.42*u,-.34*u);
  c.save(); c.translate(-.20*u,-.56*u); c.rotate(.25);
  c.beginPath(); rr(c,-.06*u,0,.12*u,.24*u,.06*u); shp(c,skin,lw,0,.24*u); disc(c,0,.26*u,.08*u,skin,lw); c.restore();
  c.save(); c.translate(.20*u,-.56*u); c.rotate(-.2-arm);
  c.beginPath(); rr(c,-.06*u,0,.12*u,.24*u,.06*u); shp(c,skin,lw,0,.24*u); disc(c,0,.26*u,.08*u,skin,lw);
  if(a.weapon){ c.save(); c.translate(0,.26*u); c.rotate(-.3); Art.weapon(c,a.weapon,u,null); c.restore(); } c.restore();
  const hy=-.84*u,hr=.215*u;
  for(const d of [-1,1]){ c.beginPath(); c.moveTo(d*hr*.72,hy-hr*.25); c.quadraticCurveTo(d*hr*2.0,hy-hr*1.15,d*hr*1.55,hy+hr*.10);
    c.quadraticCurveTo(d*hr*1.1,hy+hr*.30,d*hr*.72,hy+hr*.25); c.closePath(); shp(c,skin,lw,hy-hr,hy+hr*.3); }
  disc(c,0,hy,hr,skin,lw); rim(c,-.08*u,hy-.085*u,.07*u,.05*u,.28);
  face(c,u,0,hy,hr,{mouth:false});
  c.fillStyle='#fff'; c.beginPath(); c.moveTo(-hr*.30,hy+hr*.42); c.lineTo(hr*.30,hy+hr*.42); c.lineTo(hr*.20,hy+hr*.72); c.lineTo(-hr*.20,hy+hr*.72); c.closePath(); c.fill(); ols(c,lw*.7);
  c.strokeStyle=OL; c.lineWidth=lw*.6; c.beginPath(); c.moveTo(0,hy+hr*.42); c.lineTo(0,hy+hr*.72); c.stroke();
  c.restore();
};

/* ---- SKELETON ---- */
Art.skeleton=function(c,a,o,u){
  const t=o.t,lw=Math.max(1.1,u*.07),bone='#f2f0e2';
  const sw=o.walk? Math.sin(t*14)*.07*u:0, bob=o.walk? Math.abs(Math.sin(t*14))*.03*u:0;
  const arm=o.atk>0? Math.sin(o.atk*Math.PI)*1.6:0;
  gsh(c,u,.24); c.save(); c.translate(0,-bob);
  for(const d of [-1,1]){ const x=d*.085*u,o2=d>0?sw:-sw;
    c.beginPath(); rr(c,x-.055*u,-.30*u,.11*u,.24*u+o2*.4,.05*u); shp(c,bone,lw,-.30*u,-.04*u);
    c.beginPath(); rr(c,x-.075*u,-.09*u+o2*.4,.15*u,.11*u,.05*u); shp(c,bone,lw,-.09*u,.02*u); }
  c.beginPath(); rr(c,-.15*u,-.60*u,.30*u,.30*u,.10*u); shp(c,bone,lw,-.60*u,-.30*u);
  c.strokeStyle=OL; c.lineWidth=lw*.75;
  for(let i=0;i<3;i++){ c.beginPath(); c.moveTo(-.11*u,(-.53+i*.08)*u); c.lineTo(.11*u,(-.53+i*.08)*u); c.stroke(); }
  c.save(); c.translate(-.155*u,-.55*u); c.rotate(.3);
  c.beginPath(); rr(c,-.05*u,0,.10*u,.24*u,.05*u); shp(c,bone,lw,0,.24*u); disc(c,0,.26*u,.07*u,bone,lw); c.restore();
  c.save(); c.translate(.155*u,-.55*u); c.rotate(-.25-arm);
  c.beginPath(); rr(c,-.05*u,0,.10*u,.24*u,.05*u); shp(c,bone,lw,0,.24*u); disc(c,0,.26*u,.07*u,bone,lw);
  c.save(); c.translate(0,.26*u); c.rotate(-.3); Art.weapon(c,'dagger',u*.9,null); c.restore(); c.restore();
  const hy=-.84*u,hr=.21*u;
  c.beginPath(); rr(c,-hr,hy-hr*.95,hr*2,hr*1.75,hr*.55); shp(c,bone,lw,hy-hr,hy+hr*.8);
  c.fillStyle=OL;
  c.beginPath(); c.ellipse(-hr*.38,hy-hr*.06,hr*.26,hr*.30,0,0,6.3); c.fill();
  c.beginPath(); c.ellipse( hr*.38,hy-hr*.06,hr*.26,hr*.30,0,0,6.3); c.fill();
  c.beginPath(); c.moveTo(0,hy+hr*.20); c.lineTo(-hr*.12,hy+hr*.44); c.lineTo(hr*.12,hy+hr*.44); c.closePath(); c.fill();
  c.strokeStyle=OL; c.lineWidth=lw*.7;
  for(let i=-2;i<=2;i++){ c.beginPath(); c.moveTo(i*hr*.30,hy+hr*.56); c.lineTo(i*hr*.30,hy+hr*.78); c.stroke(); }
  rim(c,-hr*.45,hy-hr*.6,hr*.3,hr*.16,.4);
  c.restore();
};

/* ---- FLYER (kelelawar/wisp) ---- */
Art.flyer=function(c,a,o,u){
  const t=o.t,lw=Math.max(1.1,u*.075),body=a.body||'#5fd0f5',wing=a.wing||'#b8e9ff';
  const f=Math.sin(t*13), hov=Math.sin(t*3.2)*.05*u;
  ell(c,0,.10*u,.20*u,.07*u,'rgba(0,0,0,.26)');
  c.save(); c.translate(0,-.62*u+hov);
  for(const d of [-1,1]){ c.save(); c.scale(d,1); c.rotate(f*.42);
    c.beginPath(); c.moveTo(.14*u,-.04*u); c.quadraticCurveTo(.62*u,-.40*u,.72*u,-.02*u);
    c.quadraticCurveTo(.60*u,.02*u,.56*u,.16*u); c.quadraticCurveTo(.42*u,.06*u,.32*u,.20*u);
    c.quadraticCurveTo(.24*u,.10*u,.14*u,.16*u); c.closePath(); shp(c,wing,lw,-.4*u,.2*u); c.restore(); }
  disc(c,0,0,.235*u,body,lw); rim(c,-.09*u,-.10*u,.08*u,.055*u,.35);
  for(const d of [-1,1]){ c.beginPath(); c.moveTo(d*.10*u,-.19*u); c.lineTo(d*.22*u,-.42*u); c.lineTo(d*.24*u,-.14*u); c.closePath(); shp(c,body,lw,-.42*u,-.14*u); }
  face(c,u,0,.01*u,.20*u,{mouth:false});
  c.fillStyle='#fff'; c.beginPath(); c.moveTo(-.06*u,.10*u); c.lineTo(-.02*u,.10*u); c.lineTo(-.04*u,.17*u); c.closePath();
  c.moveTo(.06*u,.10*u); c.lineTo(.02*u,.10*u); c.lineTo(.04*u,.17*u); c.closePath(); c.fill();
  c.restore();
};

/* ---- DRAGON ---- */
Art.dragon=function(c,a,o,u){
  const t=o.t,lw=Math.max(1.2,u*.075),body=a.body||'#5ac8ff',belly=a.belly||'#d8f2ff';
  const f=Math.sin(t*9), hov=Math.sin(t*2.6)*.055*u;
  ell(c,0,.12*u,.30*u,.10*u,'rgba(0,0,0,.28)');
  c.save(); c.translate(0,-.66*u+hov);
  for(const d of [-1,1]){ c.save(); c.scale(d,1); c.rotate(f*.30);
    c.beginPath(); c.moveTo(.16*u,-.10*u); c.quadraticCurveTo(.72*u,-.62*u,.88*u,-.10*u);
    c.quadraticCurveTo(.70*u,-.06*u,.66*u,.16*u); c.quadraticCurveTo(.50*u,-.02*u,.42*u,.22*u);
    c.quadraticCurveTo(.30*u,.04*u,.16*u,.14*u); c.closePath(); shp(c,shade(body,-.18),lw,-.62*u,.22*u); c.restore(); }
  c.beginPath(); c.moveTo(.06*u,.16*u); c.quadraticCurveTo(.36*u,.42*u,.16*u,.62*u);
  c.quadraticCurveTo(.30*u,.44*u,-.02*u,.26*u); c.closePath(); shp(c,body,lw,.16*u,.62*u);
  c.beginPath(); c.ellipse(0,.10*u,.235*u,.28*u,0,0,6.3); shp(c,body,lw,-.18*u,.38*u);
  c.beginPath(); c.ellipse(0,.16*u,.145*u,.19*u,0,0,6.3); shp(c,belly,lw*.7,-.03*u,.35*u);
  for(const d of [-1,1]){ c.beginPath(); rr(c,d*.20*u-.05*u,-.02*u,.10*u,.20*u,.045*u); shp(c,body,lw,-.02*u,.18*u); }
  disc(c,0,-.24*u,.225*u,body,lw); rim(c,-.085*u,-.33*u,.075*u,.05*u,.34);
  for(const d of [-1,1]){ c.beginPath(); c.moveTo(d*.10*u,-.42*u); c.lineTo(d*.19*u,-.62*u); c.lineTo(d*.22*u,-.36*u); c.closePath(); shp(c,shade(body,-.25),lw,-.62*u,-.36*u); }
  c.beginPath(); c.ellipse(0,-.16*u,.13*u,.09*u,0,0,6.3); shp(c,belly,lw*.7,-.25*u,-.07*u);
  c.fillStyle=OL; c.beginPath(); c.arc(-.045*u,-.17*u,.022*u,0,6.3); c.arc(.045*u,-.17*u,.022*u,0,6.3); c.fill();
  face(c,u,0,-.30*u,.20*u,{mouth:false});
  c.restore();
};

/* ---- BEAST + rider ---- */
Art.beast=function(c,a,o,u){
  const t=o.t,lw=Math.max(1.2,u*.075),body=a.body||'#a86b45';
  const g=o.walk? Math.abs(Math.sin(t*11))*.04*u:0, sw=o.walk? Math.sin(t*11)*.07*u:0;
  gsh(c,u,.34); c.save(); c.translate(0,-g);
  for(const d of [-1,1]){ for(const b of [-1,1]){ const x=d*.20*u, o2=(d*b>0?sw:-sw);
    c.beginPath(); rr(c,x-.055*u+b*.045*u,-.22*u,.11*u,.20*u+o2*.4,.05*u); shp(c,shade(body,-.25),lw,-.22*u,-.02*u); } }
  c.beginPath(); c.ellipse(0,-.36*u,.34*u,.24*u,0,0,6.3); shp(c,body,lw,-.60*u,-.12*u);
  c.beginPath(); c.ellipse(0,-.30*u,.22*u,.13*u,0,0,6.3); shp(c,shade(body,.22),lw*.6,-.43*u,-.17*u);
  c.save(); c.translate(0,-.56*u);
  disc(c,0,0,.185*u,shade(body,.05),lw); rim(c,-.07*u,-.08*u,.06*u,.04*u,.3);
  for(const d of [-1,1]){ c.beginPath(); c.moveTo(d*.09*u,-.14*u); c.lineTo(d*.17*u,-.32*u); c.lineTo(d*.19*u,-.10*u); c.closePath(); shp(c,shade(body,-.2),lw,-.32*u,-.1*u); }
  for(const d of [-1,1]){ c.beginPath(); c.moveTo(d*.16*u,.02*u); c.quadraticCurveTo(d*.34*u,-.06*u,d*.30*u,-.20*u); c.quadraticCurveTo(d*.20*u,-.10*u,d*.14*u,-.06*u); c.closePath(); shp(c,'#f6f2e4',lw*.8,-.2*u,.02*u); }
  c.fillStyle=OL; c.beginPath(); c.arc(-.06*u,-.01*u,.028*u,0,6.3); c.arc(.06*u,-.01*u,.028*u,0,6.3); c.fill();
  c.beginPath(); c.ellipse(0,.09*u,.075*u,.055*u,0,0,6.3); shp(c,'#e0a090',lw*.6,.03*u,.15*u);
  c.restore();
  if(a.rider){ c.save(); c.translate(0,-.62*u); c.scale(.72,.72);
    Art.humanoid(c,{skin:'#f6c9a0',cloth:a.rider,armor:shade(a.rider,-.3),weapon:'sword',helm:1,sz:1},{t:t,walk:0,atk:o.atk},u*.82); c.restore(); }
  c.restore();
};

/* ---- GOLEM ---- */
Art.golem=function(c,a,o,u){
  const t=o.t,lw=Math.max(1.3,u*.08),body=a.body||'#6b7a92',crack=a.crack||'#ffb04a';
  const g=o.walk? Math.abs(Math.sin(t*5.5))*.035*u:0, sw=o.walk? Math.sin(t*5.5)*.06*u:0;
  const arm=o.atk>0? Math.sin(o.atk*Math.PI)*1.3:0;
  gsh(c,u,.40); c.save(); c.translate(0,-g);
  for(const d of [-1,1]){ const x=d*.20*u,o2=d>0?sw:-sw;
    c.beginPath(); rr(c,x-.145*u,-.36*u,.29*u,.36*u+o2*.4,.09*u); shp(c,shade(body,-.15),lw,-.36*u,0); }
  c.save(); c.translate(-.44*u,-.60*u); c.rotate(.2+arm*.5);
  c.beginPath(); rr(c,-.10*u,0,.20*u,.30*u,.09*u); shp(c,body,lw,0,.30*u); disc(c,0,.34*u,.155*u,body,lw); c.restore();
  c.save(); c.translate(.44*u,-.60*u); c.rotate(-.2-arm);
  c.beginPath(); rr(c,-.10*u,0,.20*u,.30*u,.09*u); shp(c,body,lw,0,.30*u); disc(c,0,.34*u,.155*u,body,lw); c.restore();
  c.beginPath(); c.moveTo(-.34*u,-.86*u); c.lineTo(.34*u,-.86*u); c.lineTo(.30*u,-.32*u); c.lineTo(-.30*u,-.32*u); c.closePath();
  shp(c,body,lw,-.86*u,-.32*u);
  disc(c,-.36*u,-.78*u,.155*u,shade(body,.1),lw); disc(c,.36*u,-.78*u,.155*u,shade(body,.1),lw);
  c.strokeStyle=crack; c.lineWidth=lw*1.05; c.lineCap='round';
  if(Art.hq){ c.shadowColor=crack; c.shadowBlur=u*.22; }
  c.beginPath(); c.moveTo(-.13*u,-.80*u); c.lineTo(.05*u,-.64*u); c.lineTo(-.08*u,-.54*u); c.lineTo(.10*u,-.38*u); c.stroke();
  c.beginPath(); c.moveTo(.20*u,-.76*u); c.lineTo(.10*u,-.60*u); c.stroke(); c.shadowBlur=0;
  const hy=-.94*u;
  c.beginPath(); rr(c,-.19*u,hy-.16*u,.38*u,.30*u,.09*u); shp(c,shade(body,.12),lw,hy-.16*u,hy+.14*u);
  c.fillStyle=crack; if(Art.hq){ c.shadowColor=crack; c.shadowBlur=u*.2; }
  c.beginPath(); c.ellipse(-.075*u,hy-.01*u,.045*u,.032*u,0,0,6.3); c.ellipse(.075*u,hy-.01*u,.045*u,.032*u,0,0,6.3); c.fill(); c.shadowBlur=0;
  rim(c,-.12*u,hy-.11*u,.07*u,.035*u,.3);
  c.restore();
};

/* ---- TITAN elemental ---- */
Art.titan=function(c,a,o,u){
  const t=o.t,lw=Math.max(1.3,u*.075),body=a.body||'#3f5fa8',glow=a.glow||'#8fe8ff';
  const hov=Math.sin(t*2.4)*.045*u, arm=o.atk>0? Math.sin(o.atk*Math.PI)*1.2:0;
  ell(c,0,.06*u,.34*u,.12*u,'rgba(0,0,0,.30)');
  c.save(); c.translate(0,-hov);
  if(Art.hq){ const gr=c.createRadialGradient(0,-.55*u,.05*u,0,-.55*u,.85*u);
    gr.addColorStop(0,'rgba(140,230,255,.30)'); gr.addColorStop(1,'rgba(140,230,255,0)');
    c.fillStyle=gr; c.beginPath(); c.arc(0,-.55*u,.85*u,0,6.3); c.fill(); }
  c.beginPath(); c.moveTo(0,-1.02*u); c.quadraticCurveTo(.40*u,-.72*u,.34*u,-.26*u);
  c.quadraticCurveTo(.18*u,-.02*u,0,-.02*u); c.quadraticCurveTo(-.18*u,-.02*u,-.34*u,-.26*u);
  c.quadraticCurveTo(-.40*u,-.72*u,0,-1.02*u); c.closePath(); shp(c,body,lw,-1.02*u,-.02*u);
  for(const d of [-1,1]){ c.save(); c.translate(d*.30*u,-.68*u); c.rotate(d*(.3+arm*.6));
    c.beginPath(); rr(c,-.075*u,0,.15*u,.34*u,.07*u); shp(c,shade(body,-.1),lw,0,.34*u);
    disc(c,0,.38*u,.115*u,shade(body,.15),lw); c.restore(); }
  c.fillStyle=glow; if(Art.hq){ c.shadowColor=glow; c.shadowBlur=u*.30; }
  c.beginPath(); c.arc(0,-.48*u,.115*u,0,6.3); c.fill();
  c.beginPath(); c.ellipse(-.085*u,-.78*u,.055*u,.038*u,0,0,6.3); c.ellipse(.085*u,-.78*u,.055*u,.038*u,0,0,6.3); c.fill(); c.shadowBlur=0;
  c.fillStyle='rgba(255,255,255,.85)'; c.beginPath(); c.arc(0,-.48*u,.05*u,0,6.3); c.fill();
  rim(c,-.14*u,-.86*u,.09*u,.05*u,.30);
  for(let i=0;i<3;i++){ const ang=t*1.6+i*2.1, r=.44*u;
    c.fillStyle='rgba(180,240,255,.55)'; c.beginPath(); c.arc(Math.cos(ang)*r,-.55*u+Math.sin(ang)*.2*u,.035*u,0,6.3); c.fill(); }
  c.restore();
};

/* ---- CANNON / turret ---- */
Art.cannon=function(c,a,o,u){
  const lw=Math.max(1.0,u*.052), rec=o.atk>0? Math.sin(o.atk*Math.PI)*.10*u:0;
  gsh(c,u,.36);
  c.beginPath(); rr(c,-.36*u,-.24*u,.72*u,.24*u,.06*u); shp(c,'#8a5f30',lw,-.24*u,0);
  c.strokeStyle=OL; c.lineWidth=lw*.6;
  for(let i=1;i<4;i++){ c.beginPath(); c.moveTo(-.36*u+i*.18*u,-.24*u); c.lineTo(-.36*u+i*.18*u,0); c.stroke(); }
  disc(c,-.24*u,-.10*u,.10*u,'#4a3520',lw); disc(c,.24*u,-.10*u,.10*u,'#4a3520',lw);
  c.save(); c.translate(0,-.30*u+rec);
  c.beginPath(); rr(c,-.15*u,-.50*u,.30*u,.52*u,.10*u); shp(c,'#5a6478',lw,-.50*u,.02*u);
  c.beginPath(); rr(c,-.19*u,-.60*u,.38*u,.13*u,.05*u); shp(c,'#48505f',lw,-.60*u,-.47*u);
  c.beginPath(); c.ellipse(0,-.60*u,.13*u,.05*u,0,0,6.3); c.fillStyle='#1a1d26'; c.fill(); ols(c,lw*.7);
  rim(c,-.08*u,-.40*u,.035*u,.14*u,.28);
  c.restore();
};

/* ---- ikon spell ---- */
Art.spellIcon=function(c,icon,u,t){
  const lw=Math.max(1.0,u*.05);
  c.save(); c.translate(0,-.5*u);
  if(icon==='arrows'){
    for(let i=-2;i<=2;i++){ c.save(); c.translate(i*.19*u,Math.abs(i)*.05*u); c.rotate(.16*i);
      c.beginPath(); rr(c,-.026*u,-.34*u,.052*u,.62*u,.02*u); shp(c,'#8a5f30',lw*.8,-.34*u,.28*u);
      c.beginPath(); c.moveTo(-.085*u,-.28*u); c.lineTo(.085*u,-.28*u); c.lineTo(0,-.48*u); c.closePath(); shp(c,'#dfe6f2',lw*.8,-.48*u,-.28*u);
      c.beginPath(); c.moveTo(-.075*u,.30*u); c.lineTo(0,.16*u); c.lineTo(.075*u,.30*u); c.lineTo(0,.24*u); c.closePath(); shp(c,'#e04a4a',lw*.7,.16*u,.30*u); c.restore(); }
  } else if(icon==='meteor'){
    c.fillStyle='rgba(255,150,60,.30)'; c.beginPath(); c.moveTo(-.62*u,-.62*u); c.lineTo(-.14*u,-.06*u); c.lineTo(-.36*u,.14*u); c.closePath(); c.fill();
    c.fillStyle='rgba(255,200,90,.5)'; c.beginPath(); c.moveTo(-.48*u,-.48*u); c.lineTo(-.10*u,-.04*u); c.lineTo(-.26*u,.08*u); c.closePath(); c.fill();
    disc(c,0,0,.30*u,'#e8541c',lw);
    c.fillStyle='#ffb04a'; c.beginPath(); c.arc(-.06*u,-.06*u,.16*u,0,6.3); c.fill();
    c.fillStyle='#ffe9a0'; c.beginPath(); c.arc(-.09*u,-.09*u,.075*u,0,6.3); c.fill();
    c.fillStyle='rgba(60,20,10,.5)'; c.beginPath(); c.arc(.12*u,.10*u,.06*u,0,6.3); c.arc(.02*u,.16*u,.04*u,0,6.3); c.fill();
  } else if(icon==='zap'){
    c.beginPath(); c.moveTo(.10*u,-.60*u); c.lineTo(-.26*u,-.02*u); c.lineTo(-.02*u,-.02*u);
    c.lineTo(-.12*u,.58*u); c.lineTo(.28*u,-.06*u); c.lineTo(.03*u,-.06*u); c.closePath();
    if(Art.hq){ c.shadowColor='#8fe0ff'; c.shadowBlur=u*.35; }
    shp(c,'#7fdcff',lw,-.60*u,.58*u,.45); c.shadowBlur=0;
    c.fillStyle='rgba(255,255,255,.8)'; c.beginPath(); c.moveTo(.06*u,-.48*u); c.lineTo(-.14*u,-.06*u); c.lineTo(-.02*u,-.06*u); c.lineTo(-.06*u,.34*u); c.lineTo(.06*u,-.02*u); c.lineTo(-.02*u,-.02*u); c.closePath(); c.fill();
  }
  c.restore();
};

Art.unit=function(c,card,o){
  const a=card.art||{k:'humanoid'}, u=o.s*(a.sz||1)*1.34;
  o.walk=o.walk||0; o.t=o.t||0; o.atk=o.atk||0;
  switch(a.k){
    case 'goblin':   Art.goblin(c,a,o,u); break;
    case 'skeleton': Art.skeleton(c,a,o,u); break;
    case 'flyer':    Art.flyer(c,a,o,u); break;
    case 'dragon':   Art.dragon(c,a,o,u); break;
    case 'beast':    Art.beast(c,a,o,u); break;
    case 'golem':    Art.golem(c,a,o,u); break;
    case 'titan':    Art.titan(c,a,o,u); break;
    case 'cannon':   Art.cannon(c,a,o,u); break;
    case 'spell':    Art.spellIcon(c,a.icon,u,o.t); break;
    default:         Art.humanoid(c,a,o,u);
  }
};

/* ---- PETI ---- */
Art.chest=function(c,kind,o){
  const k=CHESTS[kind]||CHESTS.wooden,u=o.s,open=o.open||0,t=o.t||0,lw=Math.max(1.4,u*.045);
  c.save(); c.translate(o.x||0,o.y||0);
  ell(c,0,.54*u,.58*u,.14*u,'rgba(0,0,0,.32)');
  if(open>.05&&Art.hq){ const gr=c.createRadialGradient(0,-.05*u,.02*u,0,-.05*u,1.5*u*open);
    gr.addColorStop(0,'rgba(255,240,170,'+(.55*open)+')'); gr.addColorStop(1,'rgba(255,240,170,0)');
    c.fillStyle=gr; c.beginPath(); c.arc(0,-.05*u,1.5*u*open,0,6.3); c.fill();
    c.save(); c.globalAlpha=.30*open; c.translate(0,-.05*u); c.rotate(t*.5);
    for(let i=0;i<10;i++){ c.rotate(6.2832/10); c.fillStyle='#fff6c0';
      c.beginPath(); c.moveTo(0,0); c.lineTo(1.5*u,-.10*u); c.lineTo(1.5*u,.10*u); c.closePath(); c.fill(); } c.restore(); }
  c.beginPath(); rr(c,-.52*u,-.06*u,1.04*u,.58*u,.09*u); shp(c,k.c1,lw,-.06*u,.52*u);
  c.beginPath(); rr(c,-.52*u,.14*u,1.04*u,.12*u,.04*u); shp(c,'#f2cf5c',lw*.8,.14*u,.26*u);
  c.strokeStyle='rgba(0,0,0,.22)'; c.lineWidth=lw*.7;
  c.beginPath(); c.moveTo(-.18*u,.26*u); c.lineTo(-.18*u,.52*u); c.moveTo(.18*u,.26*u); c.lineTo(.18*u,.52*u); c.stroke();
  c.save(); c.translate(0,-.06*u); c.rotate(-open*1.15);
  c.beginPath(); c.moveTo(-.52*u,0); c.lineTo(-.52*u,-.18*u); c.quadraticCurveTo(0,-.62*u,.52*u,-.18*u); c.lineTo(.52*u,0); c.closePath();
  shp(c,k.c1,lw,-.62*u,0,.36);
  c.beginPath(); c.moveTo(-.10*u,-.44*u); c.quadraticCurveTo(0,-.50*u,.10*u,-.44*u); c.lineTo(.10*u,-.02*u); c.lineTo(-.10*u,-.02*u); c.closePath();
  shp(c,'#f2cf5c',lw*.8,-.5*u,0);
  c.fillStyle='rgba(255,255,255,.28)'; c.beginPath(); c.ellipse(-.24*u,-.28*u,.14*u,.06*u,-.42,0,6.3); c.fill();
  c.restore();
  c.beginPath(); rr(c,-.13*u,-.06*u,.26*u,.24*u,.05*u); shp(c,'#f7d95e',lw,-.06*u,.18*u);
  disc(c,0,.05*u,.055*u,'#8a6410',lw*.7);
  if(open>.05) for(let i=0;i<12;i++){
    const ang=-Math.PI/2+(i/11-.5)*2.4, d=(.35+((i*37)%10)/10*.75)*u*open*1.7;
    c.fillStyle='#fff0a8'; c.beginPath(); c.arc(Math.cos(ang)*d,-.06*u+Math.sin(ang)*d,.05*u,0,6.3); c.fill(); ols(c,lw*.5); }
  c.restore();
};

/* ---- TOWER ---- */
Art.tower=function(c,kind,team,o){
  const s=o.s,king=kind==='king',lw=Math.max(1.2,s*.040);
  const w=(king?1.55:1.24)*s, h=(king?1.95:1.55)*s;
  const c1=team===0?'#4b8dff':'#ff4d4d', c2=team===0?'#1e4bb8':'#a81f1f';
  ell(c,0,.20*s,w*.66,w*.24,'rgba(0,0,0,.38)');
  c.beginPath(); rr(c,-w/2-.09*s,-.10*s,w+.18*s,.30*s,.07*s); shp(c,'#9aa3b8',lw,-.10*s,.20*s);
  c.beginPath(); rr(c,-w/2,-h,w,h+.02*s,.08*s); shp(c,'#b8c1d4',lw,-h,0,.16);
  c.save(); c.beginPath(); rr(c,-w/2,-h,w,h+.02*s,.08*s); c.clip();
  c.strokeStyle='rgba(45,55,78,.42)'; c.lineWidth=Math.max(1,s*.028);
  const rows=king?6:5, rh=h/rows;
  for(let i=1;i<rows;i++){ c.beginPath(); c.moveTo(-w/2,-h+rh*i); c.lineTo(w/2,-h+rh*i); c.stroke(); }
  for(let i=0;i<rows;i++){ const y=-h+rh*i, off=(i%2)?w*.17:-w*.17;
    c.beginPath(); c.moveTo(off,y); c.lineTo(off,y+rh); c.stroke();
    c.beginPath(); c.moveTo(off+(i%2?-w*.34:w*.34),y); c.lineTo(off+(i%2?-w*.34:w*.34),y+rh); c.stroke(); }
  c.fillStyle='rgba(255,255,255,.20)'; c.fillRect(-w/2,-h,w*.24,h);
  c.fillStyle='rgba(20,28,48,.20)'; c.fillRect(w*.28,-h,w*.22,h);
  c.restore();
  const n=king?5:4, cw=w/n;
  for(let i=0;i<n;i++){ c.beginPath(); rr(c,-w/2+i*cw+.02*s,-h-.24*s,cw-.07*s,.28*s,.03*s); shp(c,'#c9d2e2',lw,-h-.24*s,-h+.04*s,.14); }
  c.beginPath(); c.moveTo(-w*.21,-h*.76); c.lineTo(w*.21,-h*.76); c.lineTo(w*.21,-h*.24);
  c.lineTo(0,-h*.36); c.lineTo(-w*.21,-h*.24); c.closePath(); shp(c,c1,lw,-h*.76,-h*.24);
  c.fillStyle='rgba(255,255,255,.85)'; c.font='900 '+(.34*s)+'px "Lilita One",sans-serif'; c.textAlign='center'; c.textBaseline='middle';
  c.fillText(king?'♛':'✦',0,-h*.55);
  c.beginPath(); rr(c,-w*.15,-h*.94,w*.30,.20*s,.04*s); shp(c,'#2b3450',lw*.8,-h*.94,-h*.94+.20*s);
  if(king){
    c.save(); c.translate(0,-h-.30*s);
    c.beginPath(); c.moveTo(-.34*s,.12*s); c.lineTo(-.38*s,-.28*s); c.lineTo(-.15*s,-.08*s); c.lineTo(0,-.36*s);
    c.lineTo(.15*s,-.08*s); c.lineTo(.38*s,-.28*s); c.lineTo(.34*s,.12*s); c.closePath(); shp(c,'#ffd24a',lw,-.36*s,.12*s,.3);
    c.fillStyle='#e04a6a'; c.beginPath(); c.arc(0,-.02*s,.06*s,0,6.3); c.fill(); ols(c,lw*.6); c.restore();
  } else {
    c.save(); c.translate(0,-h-.14*s);
    c.beginPath(); rr(c,-.30*s,-.14*s,.60*s,.14*s,.05*s); shp(c,'#7a5228',lw,-.14*s,0);
    c.beginPath(); rr(c,-.075*s,-.42*s,.15*s,.32*s,.05*s); shp(c,'#4a5468',lw,-.42*s,-.10*s);
    disc(c,0,-.44*s,.10*s,c1,lw); c.restore();
  }
  if(o.dmgFlash>0){ c.save(); c.beginPath(); rr(c,-w/2,-h,w,h,.08*s); c.fillStyle='rgba(255,90,90,'+(o.dmgFlash*.55)+')'; c.fill(); c.restore(); }
};

/* ---- EMBLEM brand: pedang silang + perisai + mahkota ---- */
Art.logo=function(c,u){
  const lw=Math.max(1.6,u*.030);
  c.save();
  /* pedang silang */
  for(const d of [-1,1]){ c.save(); c.rotate(d*.60); c.translate(0,.05*u);
    c.beginPath(); rr(c,-.05*u,.06*u,.10*u,.52*u,.04*u); shp(c,'#8a5a2f',lw,.06*u,.58*u);
    c.beginPath(); c.arc(0,.62*u,.075*u,0,6.2832); shp(c,'#f2c23a',lw,.545*u,.695*u,.34);
    c.beginPath(); rr(c,-.23*u,-.02*u,.46*u,.10*u,.045*u); shp(c,'#f2c23a',lw,-.02*u,.08*u,.34);
    c.beginPath(); c.moveTo(-.078*u,-.01*u); c.lineTo(.078*u,-.01*u); c.lineTo(.05*u,-1.08*u); c.lineTo(0,-1.24*u); c.lineTo(-.05*u,-1.08*u); c.closePath();
    shp(c,'#e9eef8',lw,-1.24*u,-.01*u,.22);
    c.fillStyle='rgba(255,255,255,.5)'; c.beginPath(); c.moveTo(-.030*u,-.06*u); c.lineTo(-.008*u,-.06*u); c.lineTo(-.006*u,-1.02*u); c.lineTo(-.028*u,-.99*u); c.closePath(); c.fill();
    c.restore(); }
  /* perisai */
  c.beginPath(); c.moveTo(-.44*u,-.42*u); c.lineTo(.44*u,-.42*u); c.lineTo(.44*u,.12*u);
  c.quadraticCurveTo(.40*u,.56*u,0,.80*u); c.quadraticCurveTo(-.40*u,.56*u,-.44*u,.12*u); c.closePath();
  shp(c,'#ffcf3f',lw*1.5,-.42*u,.80*u,.34);
  c.save(); c.beginPath(); c.moveTo(-.35*u,-.33*u); c.lineTo(.35*u,-.33*u); c.lineTo(.35*u,.10*u);
  c.quadraticCurveTo(.32*u,.46*u,0,.66*u); c.quadraticCurveTo(-.32*u,.46*u,-.35*u,.10*u); c.closePath();
  shp(c,'#2c4aa8',lw,-.33*u,.66*u,.28); c.clip();
  c.fillStyle='rgba(255,255,255,.13)'; c.beginPath(); c.moveTo(-.35*u,-.33*u); c.lineTo(0,-.33*u); c.lineTo(0,.66*u); c.lineTo(-.35*u,.1*u); c.closePath(); c.fill();
  c.fillStyle='rgba(0,0,0,.16)'; c.fillRect(-.35*u,.02*u,.7*u,.7*u);
  c.restore();
  /* mahkota kecil di perisai */
  c.beginPath(); c.moveTo(-.19*u,.14*u); c.lineTo(-.21*u,-.14*u); c.lineTo(-.08*u,-.01*u); c.lineTo(0,-.20*u);
  c.lineTo(.08*u,-.01*u); c.lineTo(.21*u,-.14*u); c.lineTo(.19*u,.14*u); c.closePath();
  shp(c,'#ffcf3f',lw,-.20*u,.14*u,.35);
  /* mahkota besar di atas */
  c.save(); c.translate(0,-.52*u);
  c.beginPath(); c.moveTo(-.40*u,.10*u); c.lineTo(-.44*u,-.30*u); c.lineTo(-.17*u,-.08*u); c.lineTo(0,-.40*u);
  c.lineTo(.17*u,-.08*u); c.lineTo(.44*u,-.30*u); c.lineTo(.40*u,.10*u); c.closePath();
  shp(c,'#ffcf3f',lw*1.4,-.40*u,.10*u,.38);
  c.beginPath(); rr(c,-.40*u,.06*u,.80*u,.13*u,.05*u); shp(c,'#ffb61e',lw,.06*u,.19*u,.34);
  ;[[-.30,-.20,'#4fe3d0'],[0,-.28,'#ff5555'],[.30,-.20,'#4fe3d0']].forEach(g=>{
    c.beginPath(); c.arc(g[0]*u,g[1]*u,.055*u,0,6.3); shp(c,g[2],lw,(g[1]-.055)*u,(g[1]+.055)*u,.4); });
  c.restore(); c.restore();
};

/* ---- portrait kartu ala CR ---- */
function renderPortrait(cv,cardId,size){
  const card=CARD[cardId]; if(!card) return;
  Art.hq=true; size=Math.max(38,size||96);
  const c=fitCanvas(cv,size,size*1.05); const W=size,H=size*1.05, rar=RARITY[card.r];
  const g=c.createLinearGradient(0,0,0,H);
  g.addColorStop(0,shade(rar.c,.34)); g.addColorStop(.42,shade(rar.c,-.30)); g.addColorStop(1,shade(rar.c,-.62));
  c.fillStyle=g; c.fillRect(0,0,W,H);
  c.save(); c.globalAlpha=.065; c.fillStyle='#fff';
  for(let i=-3;i<7;i++){ c.save(); c.translate(i*W/3.4,0); c.rotate(.30); c.fillRect(0,-H,W/9,H*3); c.restore(); }
  c.restore();
  const gl=c.createRadialGradient(W/2,H*.60,2,W/2,H*.60,W*.64);
  gl.addColorStop(0,'rgba(255,255,255,.30)'); gl.addColorStop(1,'rgba(255,255,255,0)');
  c.fillStyle=gl; c.fillRect(0,0,W,H);
  c.save(); c.translate(W/2,H*.87);
  const sc=W*(card.t==='spell'?.40:.38)/(card.art&&card.art.sz?Math.max(1,card.art.sz*.94):1);
  Art.unit(c,card,{s:sc,t:performance.now()/1000,walk:0,atk:0});
  c.restore();
  c.fillStyle='rgba(0,0,0,.30)'; c.fillRect(0,H-Math.max(2,H*.05),W,H*.05);
  c.strokeStyle='rgba(0,0,0,.55)'; c.lineWidth=Math.max(2,W*.035); c.strokeRect(c.lineWidth/2,c.lineWidth/2,W-c.lineWidth,H-c.lineWidth);
  c.strokeStyle='rgba(255,255,255,.30)'; c.lineWidth=Math.max(1,W*.014); c.strokeRect(c.lineWidth*2,c.lineWidth*2,W-c.lineWidth*4,H-c.lineWidth*4);
}
/* ==== END VERBATIM SLICE ==== */

export {
  shade, rr, ell, circ, limb, fitCanvas,
  Art, OL, ols, vg, shp, pill, disc, rim, gsh, face,
  renderPortrait,
};
