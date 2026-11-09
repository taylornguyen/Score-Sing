// Real-singing benchmark for Learn notes (frontend/melody.js) on MIR-1K karaoke clips: accompaniment (left) and
// voice (right) mixed at SAR dB, hand-labeled semitones every 20 ms. Labeled notes of at least 0.2 s stand in for words.
// Usage: node scripts/melody-benchmark.mjs <data dir> [--fetch]   (SAR=-5|0|5, default 0)
// --fetch downloads every 16th clip (63 clips, about 31 MB) from a public MIR-1K mirror into <data dir>/wav and /pv.
import fs from 'node:fs';import path from 'node:path';
import {framePitch,createMelody} from '../frontend/melody.js';
const data=process.argv[2],sar=Number(process.env.SAR||0);
if(!data||!Number.isFinite(sar))throw Error('Usage: node scripts/melody-benchmark.mjs <data dir> [--fetch]');
if(process.argv.includes('--fetch')){
 const mirror='https://huggingface.co/datasets/AnhP/Mir-1k-use-DJCM-training';
 const listing=await (await fetch(`${mirror.replace('/datasets/','/api/datasets/')}`,{signal:AbortSignal.timeout(30000)})).json();
 const names=listing.siblings.map(s=>s.rfilename).filter(f=>f.startsWith('MIR-1K/Wavfile/')).map(f=>path.basename(f,'.wav')).sort().filter((_,i)=>i%16===0);
 for(const dir of ['wav','pv'])fs.mkdirSync(path.join(data,dir),{recursive:true});
 for(const name of names)for(const [dir,remote,ext] of [['wav','Wavfile','wav'],['pv','PitchLabel','pv']]){
  const r=await fetch(`${mirror}/resolve/main/MIR-1K/${remote}/${name}.${ext}`,{signal:AbortSignal.timeout(60000)});
  if(!r.ok)throw Error(`${name}.${ext}: HTTP ${r.status}`);
  fs.writeFileSync(path.join(data,dir,`${name}.${ext}`),Buffer.from(await r.arrayBuffer()));
 }
}
const SR=48000,N=8192;
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
 for(let len=2;len<=n;len<<=1){const a=-2*Math.PI/len,wr=Math.cos(a),wi=Math.sin(a);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let j=0;j<len/2;j++){const ur=re[i+j],ui=im[i+j],vr=re[i+j+len/2]*cr-im[i+j+len/2]*ci,vi=re[i+j+len/2]*ci+im[i+j+len/2]*cr;re[i+j]=ur+vr;im[i+j]=ui+vi;re[i+j+len/2]=ur-vr;im[i+j+len/2]=ui-vi;const t=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=t;}}}}
const win=Float64Array.from({length:N},(_,i)=>0.42-0.5*Math.cos(2*Math.PI*i/N)+0.08*Math.cos(4*Math.PI*i/N));
function spectrum(x,center){const re=new Float64Array(N),im=new Float64Array(N),s=center-N/2;for(let i=0;i<N;i++){const k=s+i;re[i]=(k>=0&&k<x.length?x[k]:0)*win[i];}fft(re,im);const db=new Float32Array(N/2);for(let i=0;i<N/2;i++)db[i]=20*Math.log10(Math.hypot(re[i],im[i])/N+1e-12);return db;}
function load(file){const b=fs.readFileSync(file);let o=12,fmt,d;while(o<b.length){const id=b.toString('ascii',o,o+4),sz=b.readUInt32LE(o+4);if(id==='fmt ')fmt={ch:b.readUInt16LE(o+10),sr:b.readUInt32LE(o+12)};if(id==='data')d=b.subarray(o+8,o+8+sz);o+=8+sz+(sz&1);}
 const n=d.length/4,v=10**(sar/20),mono=new Float64Array(n);for(let i=0;i<n;i++)mono[i]=(d.readInt16LE(i*4)+v*d.readInt16LE(i*4+2))/32768/2;
 const up=new Float64Array(n*3);for(let i=0;i<n;i++){const a=mono[i],c=mono[i+1]??a;up[3*i]=a;up[3*i+1]=a+(c-a)/3;up[3*i+2]=a+2*(c-a)/3;}return up;}
let voiced=0,exact=0,chroma=0,silent=0,unvoicedFrames=0,falseAlarm=0;let notes=0,noteKnown=0,noteRight=0,noteChroma=0;
for(const name of fs.readdirSync(path.join(data,'wav')).filter(f=>f.endsWith('.wav')).sort()){
 const x=load(path.join(data,'wav',name));
 const labels=fs.readFileSync(path.join(data,'pv',name.replace('.wav','.pv')),'utf8').trim().split(/\s+/).map(Number);
 const frames=labels.map((l,k)=>{const t=0.02+0.02*k;return {t,label:l>0?Math.round(l):0,est:framePitch(spectrum(x,Math.round(t*SR)),SR,N)};});
 for(const f of frames){if(f.label){voiced++;if(!f.est)silent++;else{if(f.est.midi===f.label)exact++;if((f.est.midi-f.label)%12===0)chroma++;}}else{unvoicedFrames++;if(f.est)falseAlarm++;}}
 // Frames 0.1 s either side of each note vote too, as word timing is estimated.
 const segs=[];let k=0;while(k<frames.length){let j=k;while(j+1<frames.length&&frames[j+1].label===frames[k].label)j++;if(frames[k].label&&(j-k+1)*0.02>=0.2)segs.push({a:frames[k].t-0.1,b:frames[j].t+0.1,label:frames[k].label});k=j+1;}
 const words=segs.map((s,i)=>({text:String(i),start:s.a,end:s.b})),m=createMelody(words);
 // 50 ms analysis steps like the app.
 segs.forEach((s,i)=>{for(let t=s.a;t<s.b;t+=0.05){if(t<0)continue;m.add(i,framePitch(spectrum(x,Math.round(t*SR)),SR,N));}});
 m.pitches().forEach((p,i)=>{notes++;if(p!==null){noteKnown++;if(p===segs[i].label)noteRight++;if((p-segs[i].label)%12===0)noteChroma++;}});
}
const pct=(a,b)=>(100*a/b).toFixed(1)+'%';
console.log(JSON.stringify({sar,frames:{voiced,exact:pct(exact,voiced),chroma:pct(chroma,voiced),noPitch:pct(silent,voiced),falseAlarm:pct(falseAlarm,unvoicedFrames)},notes:{count:notes,given:pct(noteKnown,notes),right:pct(noteRight,noteKnown),rightChroma:pct(noteChroma,noteKnown),rightOfAll:pct(noteRight,notes)}}));
