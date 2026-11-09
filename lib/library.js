import {validateCues,validateCheckpoints} from '../frontend/sync.js';
import {HttpError,readJson} from './http.js';
export const limits={xmlBytes:5_000_000,bodyBytes:6_000_000,scores:200,totalBytes:200_000_000,positions:4000};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const alignmentKeys=['bpm','offset','cues','checkpoints','checkpointsDirty','catalog'];
function invalid(message){return new HttpError(400,message);}
export function validTitle(title){
 if(typeof title!=='string'||!title.trim()||title.length>200)throw invalid('Score title must be 1 to 200 characters');
 return title.trim();
}
export function validTrack(trackId){
 if(trackId!==null&&!(typeof trackId==='string'&&/^[A-Za-z0-9]{22}$/.test(trackId)))throw invalid('Use an exact 22-character Spotify track ID or null');
 return trackId;
}
export function validAlignment(a){
 if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!alignmentKeys.includes(k)))throw invalid('Alignment has unexpected fields');
 const {bpm,offset,cues,checkpoints,checkpointsDirty,catalog}=a;
 if(catalog!==undefined)validCatalog(catalog);
 if(bpm!==undefined&&!(Number.isFinite(bpm)&&bpm>=20&&bpm<=300))throw invalid('Tempo must be from 20 to 300 BPM');
 if(offset!==undefined&&!(Number.isFinite(offset)&&offset>=0))throw invalid('First-note time must be nonnegative');
 if(checkpointsDirty!==undefined&&typeof checkpointsDirty!=='boolean')throw invalid('Invalid checkpoint state');
 try{
  if(cues!==undefined){if(!Array.isArray(cues)||!cues.length||cues.length>limits.positions)throw Error('Too many cues');validateCues(cues,cues.length);}
  if(checkpoints!==undefined)validateCheckpoints(checkpoints,limits.positions);
 }catch(error){throw invalid(error.message);}
 return Object.fromEntries(alignmentKeys.filter(k=>a[k]!==undefined).map(k=>[k,a[k]]));
}
// Where an automatically found score came from (see lib/catalog.js) and how it was timed.
function validCatalog(c){
 const text=(v,max)=>v===undefined||(typeof v==='string'&&v.length<=max);
 const ok=c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).every(k=>['id','rank','count','credit','timing','timingNote'].includes(k))
  &&typeof c.id==='string'&&/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(c.id)&&Number.isInteger(c.count)&&c.count>=1&&c.count<=50
  &&Number.isInteger(c.rank)&&c.rank>=0&&c.rank<c.count&&['checking','lyrics','tempo'].includes(c.timing)&&text(c.credit,300)&&text(c.timingNote,300);
 if(!ok)throw invalid('Invalid catalog source');
}
export function validMusicXML(xml){
 if(typeof xml!=='string'||!xml)throw invalid('A saved score needs its MusicXML text');
 if(Buffer.byteLength(xml)>limits.xmlBytes)throw new HttpError(413,'Choose a score under 5 MB');
 if(!/<score-partwise[\s>]/.test(xml))throw invalid('Use partwise MusicXML');
 return xml;
}
const columns='id,title,track_id,revision,bytes,updated_at';
const meta=r=>({id:r.id,title:r.title,trackId:r.track_id,revision:r.revision,bytes:r.bytes,updatedAt:r.updated_at.toISOString()});
// Every statement is filtered by the verified subject; ids are never looked up across accounts.
export function createLibraryStore(db){
 return {
  async list(subject){
   const {rows}=await db.query(`SELECT ${columns} FROM library_scores WHERE subject=$1 ORDER BY updated_at DESC, id LIMIT ${limits.scores}`,[subject]);
   return rows.map(meta);
  },
  async get(subject,id){
   const {rows}=await db.query(`SELECT ${columns},musicxml,alignment FROM library_scores WHERE subject=$1 AND id=$2`,[subject,id]);
   if(!rows.length)throw new HttpError(404,'Score not found');
   return {...meta(rows[0]),xml:rows[0].musicxml,alignment:rows[0].alignment};
  },
  async create(subject,id,{title,trackId,xml,alignment}){
   const bytes=Buffer.byteLength(xml);
   return db.transaction(async client=>{
    // Serializes one account's quota checks without blocking other accounts.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[subject]);
    const existing=await client.query(`SELECT ${columns},md5(musicxml) AS digest FROM library_scores WHERE subject=$1 AND id=$2`,[subject,id]);
    if(existing.rows.length){
     const {rows:[{digest}]}=await client.query('SELECT md5($1::text) AS digest',[xml]);
     if(existing.rows[0].digest!==digest)throw new HttpError(409,'A different score already uses this ID');
     return {...meta(existing.rows[0]),created:false};
    }
    const {rows:[usage]}=await client.query('SELECT count(*)::int AS scores,coalesce(sum(bytes),0)::bigint AS bytes FROM library_scores WHERE subject=$1',[subject]);
    if(usage.scores>=limits.scores)throw new HttpError(507,`Your library holds at most ${limits.scores} scores`);
    if(Number(usage.bytes)+bytes>limits.totalBytes)throw new HttpError(507,'Your score library is full');
    const {rows}=await client.query(`INSERT INTO library_scores(subject,id,title,track_id,musicxml,alignment,bytes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${columns}`,[subject,id,title,trackId,xml,alignment,bytes]);
    return {...meta(rows[0]),created:true};
   });
  },
  async update(subject,id,revision,changes){
   const sets=[],values=[subject,id,revision];
   for(const [column,value] of [['title',changes.title],['track_id',changes.trackId],['alignment',changes.alignment]])if(value!==undefined){values.push(value);sets.push(`${column}=$${values.length}`);}
   const {rows}=await db.query(`UPDATE library_scores SET ${sets.join(',')},revision=revision+1,updated_at=now() WHERE subject=$1 AND id=$2 AND revision=$3 RETURNING ${columns}`,values);
   if(rows.length)return meta(rows[0]);
   const current=await db.query('SELECT revision FROM library_scores WHERE subject=$1 AND id=$2',[subject,id]);
   if(!current.rows.length)throw new HttpError(404,'Score not found');
   throw Object.assign(new HttpError(409,'This score changed on another device'),{revision:current.rows[0].revision});
  },
  async remove(subject,id){
   const {rowCount}=await db.query('DELETE FROM library_scores WHERE subject=$1 AND id=$2',[subject,id]);
   if(!rowCount)throw new HttpError(404,'Score not found');
  }
 };
}
export function createLibraryHandler({verify,store,bodyTimeout=45000}){
 return async function handle(req,res,pathname){
  const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  const match=/^\/api\/library(?:\/([^/]+))?$/.exec(pathname);
  if(!match)return false;
  let subject;
  try{subject=(await verify((req.headers.authorization||'').replace(/^Bearer /,''))).sub;}catch{json(401,{error:'Sign in to Score Sing'});return true;}
  const id=match[1];
  // The browser names the account it believes is signed in; a token from a different account cannot receive its writes.
  const expected=req.headers['x-score-sing-account'];
  if(expected!==undefined&&expected!==subject){json(409,{error:'The signed-in account changed. Reload to continue.'});return true;}
  try{
   if(id!==undefined&&!uuid.test(id))throw new HttpError(404,'Score not found');
   if(!id){
    if(req.method!=='GET')throw new HttpError(405,'Use GET');
    return json(200,{scores:await store.list(subject),limits:{scores:limits.scores,scoreBytes:limits.xmlBytes,totalBytes:limits.totalBytes}}),true;
   }
   if(req.method==='GET')return json(200,await store.get(subject,id)),true;
   if(req.method==='DELETE'){await store.remove(subject,id);return json(200,{deleted:true}),true;}
   if(req.method!=='PUT'&&req.method!=='PATCH')throw new HttpError(405,'Use GET, PUT, PATCH or DELETE');
   const body=await readJson(req,{limit:limits.bodyBytes,timeout:bodyTimeout,label:'Score'});
   if(!body||typeof body!=='object'||Array.isArray(body))throw invalid('Score body must be an object');
   if(req.method==='PUT'){
    if(Object.keys(body).some(k=>!['title','trackId','xml','alignment'].includes(k)))throw invalid('Score has unexpected fields');
    const saved=await store.create(subject,id,{title:validTitle(body.title),trackId:validTrack(body.trackId??null),xml:validMusicXML(body.xml),alignment:validAlignment(body.alignment??{})});
    const {created,...score}=saved;return json(created?201:200,score),true;
   }
   if(Object.keys(body).some(k=>!['revision','title','trackId','alignment'].includes(k)))throw invalid('Score update has unexpected fields');
   if(!Number.isInteger(body.revision)||body.revision<1)throw invalid('Score update needs the current revision');
   const changes={title:body.title===undefined?undefined:validTitle(body.title),trackId:body.trackId===undefined?undefined:validTrack(body.trackId),alignment:body.alignment===undefined?undefined:validAlignment(body.alignment)};
   if(Object.values(changes).every(v=>v===undefined))throw invalid('Score update has no changes');
   return json(200,await store.update(subject,id,body.revision,changes)),true;
  }catch(error){
   if(error instanceof HttpError)return json(error.status,{error:error.message,...(error.revision?{revision:error.revision}:{})}),true;
   return json(503,{error:'Score library is unavailable'}),true;
  }
 };
}
