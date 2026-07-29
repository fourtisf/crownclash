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

/**
 * Presentation-only randomness — see the note in render.ts. `Snd.hit()` detunes each blip
 * with `rnd(220,320)`; that must never touch the simulation's seeded stream.
 */
const rnd = (a, b) => a + Math.random() * (b - a);

/** The slice gates every cue on `S.sfx`; the screen keeps this mirror in sync with the save. */
let S = { sfx: true };
export function setSfxEnabled(on) { S = { sfx: !!on }; }

/* ==== BEGIN VERBATIM SLICE — crown-clash.html L1342-L1374 ==== */
const Snd={
  ctx:null,
  init(){ if(this.ctx) return; try{ this.ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} },
  play(freq,dur,type,vol,slide){
    if(!S||!S.sfx||!this.ctx) return;
    try{
      const t=this.ctx.currentTime, o=this.ctx.createOscillator(), g=this.ctx.createGain();
      o.type=type||'square'; o.frequency.setValueAtTime(freq,t);
      if(slide) o.frequency.exponentialRampToValueAtTime(Math.max(40,slide),t+dur);
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vol||.07,t+.012);
      g.gain.exponentialRampToValueAtTime(.0001,t+dur);
      o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t+dur+.02);
    }catch(e){}
  },
  noise(dur,vol){
    if(!S||!S.sfx||!this.ctx) return;
    try{
      const n=Math.floor(this.ctx.sampleRate*dur), b=this.ctx.createBuffer(1,n,this.ctx.sampleRate), d=b.getChannelData(0);
      for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/n,2);
      const s=this.ctx.createBufferSource(), g=this.ctx.createGain();
      s.buffer=b; g.gain.value=vol||.1; s.connect(g); g.connect(this.ctx.destination); s.start();
    }catch(e){}
  },
  hit(){ this.play(rnd(220,320),.07,'square',.035); },
  slash(){ this.noise(.09,.05); },
  deploy(){ this.play(420,.1,'triangle',.06,700); },
  boom(){ this.noise(.35,.16); this.play(90,.35,'sawtooth',.08,40); },
  coin(){ this.play(880,.07,'triangle',.07); setTimeout(()=>this.play(1320,.09,'triangle',.06),60); },
  crown(){ [660,880,1180].forEach((f,i)=>setTimeout(()=>this.play(f,.14,'triangle',.08),i*80)); },
  win(){ [523,659,784,1046].forEach((f,i)=>setTimeout(()=>this.play(f,.24,'triangle',.09),i*130)); },
  lose(){ [440,392,330,262].forEach((f,i)=>setTimeout(()=>this.play(f,.28,'sine',.09),i*150)); },
  tick(){ this.play(1200,.03,'square',.03); }
};
/* ==== END VERBATIM SLICE ==== */

export { Snd };
