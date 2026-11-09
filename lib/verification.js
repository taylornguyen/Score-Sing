const fields=['freshSamples','cursorAdvances','pauses','seeks','trackChanges','safeStops'];
// Learn notes counters arrived later; older pages omit them.
const optional=['learnFrames','learnedNotes'];
const ttl=30*60*1000;
export function createVerificationStore(now=Date.now){
 const runs=new Map();
 function prune(){for(const [key,run]of runs)if(now()-run.updatedAt>ttl)runs.delete(key);}
 function checks(run){
  const following=run.freshSamples>=3&&run.cursorAdvances>=3&&run.updatedAt-run.firstSeen>=3000;
  // At least 5 s of listening (50 ms frames) that put a note on at least one word.
  const learning=run.learnFrames>=100&&run.learnedNotes>0;
  return {following,pause:run.pauses>0,seek:run.seeks>0,trackChange:run.trackChanges>0,safeStop:run.safeStops>0,learning,complete:following&&run.pauses>0&&run.seeks>0&&run.trackChanges>0&&run.safeStops>0};
 }
 return {
  record(subject,payload){
   if(!payload||Object.keys(payload).some(k=>!['runId',...fields,...optional].includes(k))||typeof payload.runId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.runId))throw Error('Invalid content-free verification report');
   payload={...Object.fromEntries(optional.map(k=>[k,0])),...payload};
   if([...fields,...optional].some(k=>!Number.isInteger(payload[k])||payload[k]<0||payload[k]>1_000_000))throw Error('Invalid content-free verification report');
   prune();const key=subject+'/'+payload.runId,previous=runs.get(key);
   if(previous&&[...fields,...optional].some(k=>payload[k]<previous[k]))throw Error('Verification counters cannot move backward');
   if(!previous&&runs.size>=256)runs.delete(runs.keys().next().value);
   const at=now();runs.set(key,{...payload,subject,firstSeen:previous?.firstSeen??at,updatedAt:at});
  },
  read(subject){
   prune();const own=[...runs.values()].filter(r=>r.subject===subject).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,16).map(({subject,...run})=>({...run,checks:checks(run)}));
   const names=['following','pause','seek','trackChange','safeStop','learning','complete'];const result=Object.fromEntries(names.map(k=>[k,own.some(r=>r.checks[k])]));
   // Which checks any account has met, with no account, run or counter detail, so the app's agent can see real use.
   const everyone=[...runs.values()].map(checks);
   const all=Object.fromEntries(names.map(k=>[k,everyone.some(c=>c[k])]));
   return {status:result.complete?'observed':'unobserved',basis:'Content-free observations from the signed-in app; not hardware attestation',checks:result,runs:own,all:{accounts:new Set([...runs.values()].map(r=>r.subject)).size,checks:all}};
  }
 };
}
