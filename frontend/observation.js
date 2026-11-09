export function createReporter(send,{now=Date.now,newRun=()=>crypto.randomUUID()}={}){
 let runId,stats,previous=null,lastCursor=null,wasFollowing=false,lastAttempt=-Infinity,lastBody='',pending=null,controller=null,generation=0,delivery='idle';
 function reset(){generation++;controller?.abort();runId=newRun();stats={freshSamples:0,cursorAdvances:0,pauses:0,seeks:0,trackChanges:0,safeStops:0,learnFrames:0,learnedNotes:0};previous=null;lastCursor=null;wasFollowing=false;lastAttempt=-Infinity;lastBody='';pending=null;delivery='idle';}
 reset();
 async function flush(){
  if(!stats.freshSamples||pending||now()-lastAttempt<5000)return;
  const payload={runId,...stats},body=JSON.stringify(payload);if(body===lastBody)return;
  const epoch=generation;lastAttempt=now();const ownedController=new AbortController();controller=ownedController;const signal=ownedController.signal;
  const timeout=setTimeout(()=>ownedController.abort(),10000);
  const aborted=new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Verification report timed out or was cancelled','AbortError')),{once:true}));
  delivery='running';const work=Promise.race([(async()=>send(payload,signal))(),aborted]);pending=work;
  try{await work;if(epoch===generation){lastBody=body;delivery='completed';}}
  catch{if(epoch===generation)delivery=signal.aborted?'cancelled':'failed';}
  finally{clearTimeout(timeout);if(pending===work)pending=null;}
 }
 return {
  reset,flush,runId:()=>runId,delivery:()=>delivery,
  playback(snapshot){
   if(!snapshot?.item?.id||!Number.isFinite(snapshot.progress_ms))return;
   stats.freshSamples++;
   if(previous){
    if(snapshot.item.id!==previous.item.id)stats.trackChanges++;
    else{
     if(previous.is_playing&&!snapshot.is_playing)stats.pauses++;
     const projected=previous.progress_ms+(previous.is_playing?Math.max(0,snapshot.receivedAt-previous.receivedAt):0);
     if(Math.abs(snapshot.progress_ms-projected)>2000)stats.seeks++;
    }
   }previous=snapshot;
  },
  // Learn notes: frames credited to a word, and notes newly learned when listening stops. Counts only.
  learn({frames=0,notes=0}){stats.learnFrames+=frames;stats.learnedNotes+=Math.max(0,notes);void flush();},
  follow({following,index,playing}){
   if(!following){if(wasFollowing)stats.safeStops++;lastCursor=null;}
   else{if(playing&&lastCursor!==null&&index!==lastCursor)stats.cursorAdvances++;lastCursor=index;}
   wasFollowing=following;void flush();
  }
 };
}
