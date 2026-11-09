// Learns the sung note of each word in a words-only score from the recording, heard on this device.
// Each audio frame votes for its most salient vocal-range pitch (harmonic sum over spectral peaks) for the word
// being sung at that moment; a word gets a note once enough frames agree. Audio is never stored or sent.
export const LOW=45,HIGH=81;// A2–A5, the usual sung range
const HARMONICS=5,DECAY=0.8,RANGE_DB=60,MIN_FRAMES=4,MIN_AGREEMENT=0.35,CANDIDATES=3,VIBRATO=8,VIBRATO_CENTS=15;

// db: magnitude spectrum in decibels (AnalyserNode.getFloatFrequencyData). Returns {midi, share, candidates} or null when
// unvoiced; candidates are the strongest few pitches with their fine offset in cents, for the vibrato cue in createMelody.
// Salience follows Melodia (Salamon and Gómez, 2012): spectral peaks vote for every candidate pitch they could be a
// harmonic of, weighted by harmonic number and by how close they fall to that harmonic (within half a semitone).
// Peaks are weighted by power: in real mixes (MIR-1K karaoke clips) the lead voice's partials are usually the
// loudest, and power weighting found the sung note about four times as often as compressed (dB) weighting.
export function framePitch(db,sampleRate,fftSize){
 const binHz=sampleRate/fftSize,top=Math.min(db.length-1,Math.floor(5000/binHz));
 let loudest=-Infinity;for(let i=1;i<top;i++)if(db[i]>loudest)loudest=db[i];
 if(!(loudest>-100))return null;
 const peaks=[];
 for(let i=2;i<top;i++){
  const a=db[i-1],b=db[i],c=db[i+1];
  if(!(b>a&&b>=c&&b>loudest-RANGE_DB))continue;
  const shift=(a-c)/(2*(a-2*b+c))||0;// parabolic interpolation
  peaks.push({hz:(i+shift)*binHz,weight:10**((b-shift*(a-c)/4-loudest)/10)});
 }
 if(peaks.length<2)return null;
 const scores=new Float64Array(HIGH-LOW+1),cents=new Float64Array(HIGH-LOW+1);
 for(const peak of peaks)for(let h=1;h<=HARMONICS;h++){
  const semis=12*Math.log2(peak.hz/h/440)+69-LOW;
  const nearest=Math.round(semis);
  if(nearest<0||nearest>HIGH-LOW)continue;
  const d=semis-nearest;
  if(Math.abs(d)<0.5){const vote=peak.weight*Math.cos(Math.PI*d)**2*DECAY**(h-1);scores[nearest]+=vote;cents[nearest]+=vote*d*100;}
 }
 let best=0,total=0;for(let i=0;i<scores.length;i++){total+=scores[i];if(scores[i]>scores[best])best=i;}
 const mean=total/scores.length;
 // A flat spectrum (noise, silence, drums) has no clear winner.
 if(!(scores[best]>mean*3))return null;
 const candidates=[...scores.keys()].sort((a,b)=>scores[b]-scores[a]).slice(0,CANDIDATES).filter(i=>scores[i]>0)
  .map(i=>({midi:LOW+i,share:scores[i]/total,cents:cents[i]/scores[i]}));
 return {midi:LOW+best,share:scores[best]/total,candidates};
}

// Word index sung at `seconds`, or -1 between words. words: [{start,end}] sorted.
export function wordAt(words,seconds){
 let lo=0,hi=words.length-1;
 while(lo<=hi){const m=(lo+hi)>>1;if(seconds<words[m].start)hi=m-1;else if(seconds>=words[m].end)lo=m+1;else return m;}
 return -1;
}

// Votes per word: [{midi: weight}] from each frame's strongest pitch, frame counts, and per candidate pitch the spread of
// its fine offset across frames ({midi: [count, sum, sum of squares]} in cents). A sung note wavers (vibrato, glides)
// while backing instruments hold steady, so a wavering candidate counts for more: on real MIR-1K singing this lifted
// notes right from 64% to 67% at equal voice/band level and from 37% to 49% with the voice 5 dB under the band.
// `saved` is a previous toJSON() for the same lyrics; saves from before the spread was kept still load.
export function createMelody(words,saved){
 const key=words.map(w=>w.text).join(' '),fits=a=>Array.isArray(a)&&a.length===words.length;
 let votes=words.map(()=>({})),frames=words.map(()=>0),spread=words.map(()=>({}));
 if(saved?.schemaVersion===1&&saved.key===key&&fits(saved.votes)&&fits(saved.frames)){
  votes=saved.votes.map(v=>({...v}));frames=saved.frames.slice();
  if(fits(saved.spread))spread=saved.spread.map(v=>Object.fromEntries(Object.entries(v).map(([m,x])=>[m,x.slice()])));
 }
 const wavering=(i,m)=>{const x=spread[i][m];if(!x||x[0]<2)return 0;const mean=x[1]/x[0];return Math.sqrt(Math.max(0,x[2]/x[0]-mean*mean));};
 return {
  add(index,frame){
   if(index<0||index>=words.length||!frame)return;
   frames[index]++;votes[index][frame.midi]=(votes[index][frame.midi]||0)+frame.share;
   for(const c of frame.candidates||[]){const x=spread[index][c.midi]??=[0,0,0];x[0]++;x[1]+=c.cents;x[2]+=c.cents*c.cents;}
  },
  // MIDI per word, or null where the recording did not settle on a note.
  pitches(){
   return votes.map((v,i)=>{
    if(frames[i]<MIN_FRAMES)return null;
    const score=Object.fromEntries(Object.entries(v).map(([m,w])=>[m,w*(1+VIBRATO*Math.min(wavering(i,m),VIBRATO_CENTS)/VIBRATO_CENTS)]));
    const entries=Object.entries(score);if(!entries.length)return null;
    // Octave errors split the vote between a note and its octave; count them together, then pick the stronger.
    let best=null,total=0;
    for(const [m,w] of entries){total+=w;const together=w+(score[+m+12]||0)+(score[+m-12]||0);if(!best||together>best.together||together===best.together&&w>best.w)best={midi:+m,w,together};}
    const pc=entries.filter(([m])=>Math.abs(+m-best.midi)%12===0);const winner=pc.reduce((a,b)=>b[1]>a[1]?b:a);
    return best.together/total>=MIN_AGREEMENT?+winner[0]:null;
   });
  },
  learned(){return this.pitches().filter(m=>m!==null).length;},
  toJSON(){return {schemaVersion:1,key,votes,frames,spread};},
 };
}

// Listens to the recording: Chromium browsers can capture the screen's system/tab audio; others use the microphone.
export async function openRecordingAudio(){
 const media=navigator.mediaDevices;
 const raw={echoCancellation:false,noiseSuppression:false,autoGainControl:false};
 if(media?.getDisplayMedia&&media.getSupportedConstraints?.().suppressLocalAudioPlayback){
  const stream=await media.getDisplayMedia({video:true,audio:raw,systemAudio:'include',selfBrowserSurface:'exclude'});
  if(!stream.getAudioTracks().length){stream.getTracks().forEach(t=>t.stop());throw Error('Turn on “Share system audio” (or tab audio) when sharing, so the song can be heard');}
  return {stream,source:'shared audio'};
 }
 if(!media?.getUserMedia)throw Error('This browser cannot listen to the recording');
 return {stream:await media.getUserMedia({audio:raw}),source:'microphone'};
}
