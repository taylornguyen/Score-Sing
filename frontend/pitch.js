// On-device sung-pitch estimate (YIN). Audio never leaves the browser and is never stored.
const MIN_HZ=65,MAX_HZ=1100,THRESHOLD=0.15,SILENCE_RMS=0.01;

export function detectPitch(samples,sampleRate){
 let energy=0;for(const x of samples)energy+=x*x;
 if(Math.sqrt(energy/samples.length)<SILENCE_RMS)return null;
 const maxLag=Math.min(Math.floor(sampleRate/MIN_HZ),Math.floor(samples.length/2)),minLag=Math.max(2,Math.floor(sampleRate/MAX_HZ));
 const window=samples.length-maxLag,diff=new Float64Array(maxLag+1);
 for(let lag=1;lag<=maxLag;lag++){let sum=0;for(let i=0;i<window;i++){const d=samples[i]-samples[i+lag];sum+=d*d;}diff[lag]=sum;}
 // Cumulative mean normalized difference.
 let running=0;const cmnd=new Float64Array(maxLag+1);cmnd[0]=1;
 for(let lag=1;lag<=maxLag;lag++){running+=diff[lag];cmnd[lag]=running?diff[lag]*lag/running:1;}
 let lag=-1;
 for(let t=minLag;t<=maxLag;t++){if(cmnd[t]<THRESHOLD){while(t+1<=maxLag&&cmnd[t+1]<cmnd[t])t++;lag=t;break;}}
 if(lag<0)return null;
 const a=cmnd[lag-1]??cmnd[lag],b=cmnd[lag],c=cmnd[lag+1]??cmnd[lag],den=a-2*b+c;
 const refined=den?lag+(a-c)/(2*den):lag;
 const hz=sampleRate/refined;
 return hz>=MIN_HZ&&hz<=MAX_HZ?{hz,clarity:1-b}:null;
}

// Cents from the nearest target note, folding octaves so any voice range compares fairly.
export function compare(hz,targets){
 if(!(hz>0)||!targets?.length)return null;
 const sung=69+12*Math.log2(hz/440);let best=null;
 for(const midi of targets){
  let cents=((sung-midi)*100)%1200;if(cents>=600)cents-=1200;if(cents<-600)cents+=1200;
  if(!best||Math.abs(cents)<Math.abs(best.cents))best={cents,midi};
 }
 const cents=Math.round(best.cents);
 return {cents,state:Math.abs(cents)<=25?'in-tune':cents>0?'sharp':'flat'};
}

export function createPitchMeter({onReading,onStop}){
 let stream=null,context=null,timer=null,starting=null,generation=0;
 function stop(reason=''){
  generation++;clearInterval(timer);timer=null;
  stream?.getTracks().forEach(track=>track.stop());stream=null;
  context?.close().catch(()=>{});context=null;
  onStop(reason);
 }
 async function start(){
  if(stream||starting)return starting;
  const epoch=++generation;
  starting=(async()=>{
   if(!navigator.mediaDevices?.getUserMedia)throw Error('This browser cannot use the microphone');
   // Created inside the tap so iPhone Safari lets it run.
   context=new AudioContext();
   let timeout;
   const media=await Promise.race([
    navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}}),
    new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Microphone did not start')),15000);})]).finally(()=>clearTimeout(timeout));
   if(epoch!==generation){media.getTracks().forEach(track=>track.stop());return;}
   stream=media;await context.resume();
   if(epoch!==generation)return;
   const analyser=context.createAnalyser();analyser.fftSize=2048;
   context.createMediaStreamSource(stream).connect(analyser);
   const buffer=new Float32Array(analyser.fftSize);
   for(const track of stream.getAudioTracks())track.addEventListener('ended',()=>{if(epoch===generation)stop('Microphone disconnected');});
   timer=setInterval(()=>{analyser.getFloatTimeDomainData(buffer);onReading(detectPitch(buffer,context.sampleRate));},60);
  })().catch(e=>{
   if(epoch===generation)stop(e.name==='NotAllowedError'?'Microphone access denied':e.name==='NotFoundError'?'No microphone found':e.message||'Microphone did not start');
  }).finally(()=>{starting=null;});
  return starting;
 }
 return {start,stop,active:()=>!!stream||!!starting};
}
