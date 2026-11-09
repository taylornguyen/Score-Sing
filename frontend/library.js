// Server score library for the signed-in account, plus a one-time move of this browser's old saved score.
const alignmentFields=['bpm','offset','cues','checkpoints','checkpointsDirty','catalog'];
export const libraryUnavailable='Score library is unavailable. Changes are not being saved.';
export const deviceOnly='Score library is unavailable. Saved on this device only.';
export function createLibrary(fetchWithAuth,{storage=globalThis.localStorage,newId=()=>crypto.randomUUID()}={}){
 let account='',generation=0,scores=[];const queues=new Map();
 const legacyKey=()=>`score-sing-score-${account}`,moveKey=()=>`score-sing-score-move-${account}`;
 async function request(method,path,body,timeout){
  let response;
  try{response=await fetchWithAuth(path,{method,signal:AbortSignal.timeout(timeout),headers:{'X-Score-Sing-Account':account,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
  catch(e){throw Error(e?.name==='TimeoutError'?'Score library did not respond in time. Changes are not being saved.':libraryUnavailable);}
  let data=null;try{data=await response.json();}catch{}
  if(!response.ok){
   const e=Error(response.status===503?libraryUnavailable:response.status===401?'Sign in again to use your score library':response.status===409?data?.error==='This score changed on another device'?'This score changed on another device. Reload to use the newer copy.':data?.error||'Score library conflict':data?.error||`Score library error ${response.status}`);
   e.status=response.status;throw e;
  }
  if(!data||typeof data!=='object')throw Error('Score library returned an invalid response');
  return {status:response.status,data};
 }
 const alignment=score=>Object.fromEntries(alignmentFields.filter(k=>score[k]!==undefined).map(k=>[k,score[k]]));
 const owned=epoch=>epoch===generation;
 function remember(meta){scores=[meta,...scores.filter(s=>s.id!==meta.id)];}
 // The device copy is removed once the server holds that same score (by move ID or library ID).
 function finishMove(id){
  try{
   let local=null;try{local=JSON.parse(storage.getItem(legacyKey())||'null');}catch{}
   if(storage.getItem(moveKey())===id||local?.libraryId===id){storage.removeItem(legacyKey());storage.removeItem(moveKey());}
  }catch{}
 }
 async function send(score,epoch){
  const title=String(score.title||'').trim().slice(0,200)||'Untitled score';
  if(!score.revision){
   const {status,data}=await request('PUT','/api/library/'+score.libraryId,{title,trackId:score.trackId??null,xml:score.xml,alignment:alignment(score)},60000);
   if(!owned(epoch))return;
   score.revision=data.revision;remember(data);finishMove(data.id);if(status===201)delete score.fromDevice;
   // A retried upload found the earlier copy; bring its alignment up to this device's state.
   if(status===201)return;
  }
  let data;
  try{({data}=await request('PATCH','/api/library/'+score.libraryId,{revision:score.revision,title,trackId:score.trackId??null,alignment:alignment(score)},15000));}
  catch(e){
   if(e.status!==409||!score.fromDevice||!owned(epoch))throw e;
   // Edits kept on this device during an outage lost a race with another device: keep both as separate scores.
   const previous=score.libraryId;score.libraryId=newId();score.revision=undefined;score.title=title.slice(0,186)+' (this device)';
   finishMove(previous);return send(score,epoch);
  }
  if(owned(epoch)){score.revision=data.revision;delete score.fromDevice;remember(data);finishMove(data.id);}
 }
 // While the library is down, keep the newest score in this browser; migration() sends it later to the same library entry.
 function keepOnDevice(score){
  if(!account||score.preview)return false;
  const {preview,fromDevice,...rest}=score;
  try{storage.setItem(legacyKey(),JSON.stringify(rest));return true;}catch{return false;}
 }
 return {
  keepOnDevice,
  get scores(){return scores;},
  reset(subject){account=subject||'';generation++;scores=[];queues.clear();},
  // Returns the old browser-local score for upload ({score}), an unreadable-copy notice ({error}) or null.
  migration(){
   let raw;try{raw=storage.getItem(legacyKey());}catch{return {error:'Browser storage could not be read. Any score saved only on this device was left in place.'};}
   if(!raw)return null;
   let saved;try{saved=JSON.parse(raw);if(!saved||typeof saved.xml!=='string')throw Error();}catch{return {error:'This device’s old saved score is unreadable. It was left in browser storage.'};}
   const {preview,revision,libraryId,...score}=saved;
   const known=typeof libraryId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(libraryId);
   if(known)return {score:{...score,libraryId,...(Number.isInteger(revision)&&revision>0?{revision}:{}),fromDevice:true}};
   let id;try{id=storage.getItem(moveKey());if(!id){id=newId();storage.setItem(moveKey(),id);}}catch{id=newId();}
   return {score:{...score,libraryId:id,fromDevice:true}};
  },
  async list(){
   const epoch=generation,{data}=await request('GET','/api/library',undefined,10000);
   if(!Array.isArray(data.scores))throw Error('Score library returned an invalid list');
   if(owned(epoch))scores=data.scores;return data.scores;
  },
  async remove(id){
   await queues.get(id)?.running?.catch(()=>{});
   const epoch=generation;await request('DELETE','/api/library/'+id,undefined,15000);
   queues.delete(id);if(owned(epoch))scores=scores.filter(s=>s.id!==id);
  },
  boundTo(trackId){return scores.find(s=>s.trackId===trackId)||null;},
  async open(id){
   const {data}=await request('GET','/api/library/'+id,undefined,30000);
   if(typeof data.xml!=='string'||!data.alignment)throw Error('Score library returned an invalid score');
   return {...data.alignment,xml:data.xml,title:data.title,trackId:data.trackId,libraryId:data.id,revision:data.revision};
  },
  // Saves are serialized per score and coalesced: the newest state is sent after the one in flight.
  save(score){
   if(!account)return Promise.reject(Error('Sign in before saving scores'));
   score.libraryId??=newId();
   let queue=queues.get(score.libraryId);
   if(!queue){queue={score,dirty:false,running:null};queues.set(score.libraryId,queue);}
   queue.score=score;queue.dirty=true;
   if(!queue.running){
    const epoch=generation;
    queue.running=(async()=>{try{while(queue.dirty&&owned(epoch)){queue.dirty=false;await send(queue.score,epoch);}}finally{queue.running=null;}})();
   }
   return queue.running;
  }
 };
}
// Compact picker for saved scores; shown only when there is another saved score to choose.
export function renderSwitcher(anchor,scores,current,onPick){
 let select=document.querySelector('#score-library');
 const others=scores.some(s=>s.id!==current?.libraryId);
 if(!others||!current){select?.remove();return;}
 if(!select){
  select=document.createElement('select');select.id='score-library';select.className='button';select.setAttribute('aria-label','Saved scores');
  Object.assign(select.style,{font:'inherit',maxWidth:'15rem',minWidth:'0',marginLeft:'auto',textOverflow:'ellipsis'});
  select.addEventListener('change',()=>{const id=select.value;if(id)onPick(id);});
  anchor.before(select);
 }
 const saved=scores.some(s=>s.id===current.libraryId),items=scores.map(s=>[s.id,s.title]);
 if(!saved)items.unshift(['',current.preview?'Saved scores':current.title||'Current score']);
 // Rebuild only when the choices change, so a save finishing never resets an open picker.
 const signature=JSON.stringify(items);
 if(select.dataset.signature!==signature){
  select.replaceChildren(...items.map(([id,title])=>{const o=document.createElement('option');o.value=id;o.textContent=title;o.disabled=!id;return o;}));
  select.dataset.signature=signature;
 }
 if(document.activeElement!==select)select.value=saved?current.libraryId:'';
}
