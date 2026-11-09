import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {databaseConfig,createDatabase,StorageUnavailable} from '../lib/db.js';
import {createLibraryStore,createLibraryHandler,limits,validAlignment} from '../lib/library.js';
import {postgresAvailable,startPostgres} from './pg-fixture.js';
const xml=await fs.readFile(new URL('../frontend/sample.musicxml',import.meta.url),'utf8');
const ids={a:'00000000-0000-4000-8000-00000000000a',b:'00000000-0000-4000-8000-00000000000b',c:'00000000-0000-4000-8000-00000000000c'};
const track='1'.repeat(22);
const verify=async token=>{if(token==='alice-token')return {sub:'alice'};if(token==='bob-token')return {sub:'bob'};throw Error('invalid');};
async function serve(store){
 const handle=createLibraryHandler({verify,store,bodyTimeout:2000});
 const server=http.createServer(async(req,res)=>{if(!await handle(req,res,new URL(req.url,'http://x').pathname)){res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const call=async(method,path,{token,body,raw}={})=>{
  const response=await fetch(origin+path,{method,signal:AbortSignal.timeout(10000),headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:['GET','HEAD'].includes(method)?undefined:raw??(body===undefined?undefined:JSON.stringify(body))});
  return {status:response.status,body:await response.json()};
 };
 call.origin=origin;
 return {call,close:()=>new Promise(r=>server.close(r))};
}

test('database secret is the only connection source and is validated strictly',()=>{
 assert.deepEqual(databaseConfig('{"host":"/run/pg","database":"score_sing","user":"app_score_sing"}'),{host:'/run/pg',port:5432,database:'score_sing',user:'app_score_sing'});
 for(const bad of ['nope','[]','{"url":"sqlite://x"}','{"host":"h","database":"Bad-Name","user":"u"}','{"host":"h","database":"d","user":"u","port":0}','{"host":"h","database":"d","user":"u","password":""}'])
  assert.throws(()=>databaseConfig(bad),StorageUnavailable,bad);
});

test('missing database secret fails visibly with 503 and unavailable health, never a fallback store',async()=>{
 const db=createDatabase({secretPath:'/nonexistent/score-sing.json'});
 assert.equal(await db.health(),'unavailable');
 const {call,close}=await serve(createLibraryStore(db));
 try{
  assert.deepEqual(await call('GET','/api/library',{token:'alice-token'}),{status:503,body:{error:'Score library is unavailable'}});
  assert.equal((await call('PUT','/api/library/'+ids.a,{token:'alice-token',body:{title:'A',xml}})).status,503);
  assert.equal((await call('GET','/api/library')).status,401,'signed-out still gets 401 first');
 }finally{await close();}
});

test('library rejects signed-out requests before reading data or bodies',async()=>{
 const untouchable=new Proxy({},{get(){throw Error('store must not be touched');}});
 const {call,close}=await serve(untouchable);
 try{
  for(const [method,path] of [['GET','/api/library'],['GET','/api/library/'+ids.a],['PUT','/api/library/'+ids.a],['PATCH','/api/library/'+ids.a],['DELETE','/api/library/'+ids.a]]){
   assert.equal((await call(method,path,{body:{title:'x',xml}})).status,401,method+' '+path);
   assert.equal((await call(method,path,{token:'forged',body:{}})).status,401,method+' forged');
  }
 }finally{await close();}
});

test('PostgreSQL library: per-subject isolation, idempotent create, revisions, limits',{skip:!postgresAvailable&&'PostgreSQL binaries are not installed'},async t=>{
 const pg=startPostgres(),db=createDatabase({secretPath:pg.secret}),{call,close}=await serve(createLibraryStore(db));
 t.after(async()=>{await close();await db.close();pg.stop();});
 assert.equal(await db.health(),'ok');
 assert.equal(pg.sql("SELECT rolsuper OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname='app_score_sing'").toString().trim(),'f','app role is least-privilege');

 const created=await call('PUT','/api/library/'+ids.a,{token:'alice-token',body:{title:'Ode',trackId:null,xml,alignment:{bpm:96,offset:1.5}}});
 assert.equal(created.status,201);assert.equal(created.body.revision,1);assert.equal(created.body.trackId,null);
 const retry=await call('PUT','/api/library/'+ids.a,{token:'alice-token',body:{title:'Ode',xml}});
 assert.equal(retry.status,200,'a retried migration upload is idempotent');assert.equal(retry.body.revision,1);
 assert.equal((await call('PUT','/api/library/'+ids.a,{token:'alice-token',body:{title:'Other',xml:xml.replace('Joy','Fun')}})).status,409,'an ID cannot be reused for a different score');

 // Another account sees nothing and cannot read, change or delete by ID.
 assert.deepEqual((await call('GET','/api/library',{token:'bob-token'})).body.scores,[]);
 assert.equal((await call('GET','/api/library/'+ids.a,{token:'bob-token'})).status,404);
 assert.equal((await call('PATCH','/api/library/'+ids.a,{token:'bob-token',body:{revision:1,trackId:track}})).status,404);
 assert.equal((await call('DELETE','/api/library/'+ids.a,{token:'bob-token'})).status,404);
 const bobSame=await call('PUT','/api/library/'+ids.a,{token:'bob-token',body:{title:'Bob copy',xml}});
 assert.equal(bobSame.status,201,'the same ID in another account is a separate score');
 assert.equal((await call('GET','/api/library/'+ids.a,{token:'alice-token'})).body.title,'Ode');
 const crossed=await fetch(new URL('/api/library',call.origin),{signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer bob-token','X-Score-Sing-Account':'alice'}});
 assert.equal(crossed.status,409,'a write meant for one account is refused when another account\'s token is attached');

 const bound=await call('PATCH','/api/library/'+ids.a,{token:'alice-token',body:{revision:1,trackId:track,alignment:{bpm:100,offset:2,cues:[0.5,1,1.5],checkpoints:[{index:0,seconds:0.5},{index:2,seconds:1.5}],checkpointsDirty:false}}});
 assert.equal(bound.status,200);assert.equal(bound.body.revision,2);assert.equal(bound.body.trackId,track);
 const stale=await call('PATCH','/api/library/'+ids.a,{token:'alice-token',body:{revision:1,alignment:{bpm:90}}});
 assert.deepEqual(stale,{status:409,body:{error:'This score changed on another device',revision:2}});
 const full=await call('GET','/api/library/'+ids.a,{token:'alice-token'});
 assert.equal(full.body.xml,xml);assert.deepEqual(full.body.alignment.cues,[0.5,1,1.5]);assert.equal(full.body.trackId,track);

 await call('PUT','/api/library/'+ids.b,{token:'alice-token',body:{title:'Second',xml}});
 const list=(await call('GET','/api/library',{token:'alice-token'})).body;
 assert.deepEqual(list.scores.map(s=>s.id),[ids.b,ids.a],'newest first');assert.equal(list.scores[0].xml,undefined,'list is metadata only');
 assert.equal(list.limits.scoreBytes,5_000_000);

 for(const [body,pattern] of [[{revision:2,alignment:{bpm:900}},/Tempo/],[{revision:2,trackId:'short'},/track ID/],[{revision:2,alignment:{cues:[2,1]}},/increasing/],[{revision:2,alignment:{script:1}},/unexpected/],[{revision:2},/no changes/]]){
  const r=await call('PATCH','/api/library/'+ids.a,{token:'alice-token',body});assert.equal(r.status,400);assert.match(r.body.error,pattern);
 }
 assert.equal((await call('PUT','/api/library/not-a-uuid',{token:'alice-token',body:{title:'x',xml}})).status,404);
 assert.equal((await call('PUT','/api/library/'+ids.c,{token:'alice-token',body:{title:'x',xml:'<html>'}})).status,400);
 assert.equal((await call('PUT','/api/library/'+ids.c,{token:'alice-token',raw:'{'})).status,400);
 assert.equal((await call('PUT','/api/library/'+ids.c,{token:'alice-token',body:{title:'Big',xml:'<score-partwise>'+'x'.repeat(5_000_001)}})).status,413);
 assert.equal((await call('PUT','/api/library/'+ids.c,{token:'alice-token',raw:'"'+'x'.repeat(limits.bodyBytes+10)+'"'})).status,413);

 const saved=limits.scores;limits.scores=2;
 try{const full=await call('PUT','/api/library/'+ids.c,{token:'alice-token',body:{title:'Third',xml}});assert.equal(full.status,507);assert.match(full.body.error,/at most 2/);}
 finally{limits.scores=saved;}

 assert.equal((await call('DELETE','/api/library/'+ids.b,{token:'alice-token'})).status,200);
 assert.deepEqual((await call('GET','/api/library',{token:'alice-token'})).body.scores.map(s=>s.id),[ids.a]);
 assert.equal(pg.sql('SELECT count(*) FROM library_scores','score_sing').toString().trim(),'2','alice one score, bob one score');
});
test('alignment keeps a valid catalog source and rejects malformed ones',()=>{
 const source={id:'Qm'+'a'.repeat(44),rank:1,count:3,credit:'Hymn Singers',timing:'tempo',timingNote:'No synced lyrics for this recording'};
 assert.deepEqual(validAlignment({bpm:90,catalog:source}),{bpm:90,catalog:source});
 for(const bad of [{...source,id:'../x'},{...source,rank:3},{...source,timing:'guess'},{...source,extra:1},{...source,credit:'x'.repeat(301)},[]])
  assert.throws(()=>validAlignment({catalog:bad}),/Invalid catalog source/);
});
