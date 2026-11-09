import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {createDatabase} from '../lib/db.js';
import {createLibraryStore,createLibraryHandler} from '../lib/library.js';
import {createLibrary,libraryUnavailable} from '../frontend/library.js';
import {postgresAvailable,startPostgres} from './pg-fixture.js';
const xml=await fs.readFile(new URL('../frontend/sample.musicxml',import.meta.url),'utf8');
function memoryStorage({full=false}={}){
 const data=new Map();
 return {data,getItem:k=>data.has(k)?data.get(k):null,setItem(k,v){if(full)throw Error('QuotaExceededError');data.set(k,String(v));},removeItem:k=>data.delete(k)};
}
test('browser score library client keeps outage edits honest and without duplicates',{skip:!postgresAvailable&&'PostgreSQL binaries are not installed'},async t=>{
 const pg=startPostgres(),db=createDatabase({secretPath:pg.secret}),state={down:false},real=createLibraryStore(db);
 const store=new Proxy(real,{get:(target,key)=>(...args)=>{if(state.down)throw Error('down');return target[key](...args);}});
 const handle=createLibraryHandler({verify:async token=>{if(!token)throw Error('none');return {sub:token};},store});
 const server=http.createServer(async(req,res)=>{if(!await handle(req,res,new URL(req.url,'http://x').pathname)){res.writeHead(404);res.end('{}');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const fetchAs=subject=>(url,options)=>fetch(origin+url,{...options,headers:{...options.headers,Authorization:'Bearer '+subject}});
 const rows=subject=>pg.sql(`SELECT count(*) FROM library_scores WHERE subject='${subject}'`,'score_sing').toString().trim();
 t.after(async()=>{await new Promise(r=>server.close(r));await db.close();pg.stop();});

 await t.test('edits kept on the device during an outage return to the same library entry',async()=>{
  const storage=memoryStorage(),device=createLibrary(fetchAs('ana'),{storage});device.reset('ana');
  const score={xml,title:'Aligned',trackId:null,bpm:96,offset:0};
  await device.save(score);assert.equal(score.revision,1);assert.equal(rows('ana'),'1');
  state.down=true;score.bpm=100;
  const failure=await device.save(score).catch(e=>e);
  assert.equal(failure.message,libraryUnavailable);assert.equal(failure.status,503);
  assert.equal(device.keepOnDevice(score),true);
  state.down=false;
  const reloaded=createLibrary(fetchAs('ana'),{storage});reloaded.reset('ana');
  const moved=reloaded.migration().score;
  assert.equal(moved.libraryId,score.libraryId,'the device copy keeps its library identity');assert.equal(moved.revision,1);assert.equal(moved.fromDevice,true);
  await reloaded.save(moved);
  assert.equal(rows('ana'),'1','no duplicate entry after the outage');
  assert.equal((await reloaded.open(score.libraryId)).bpm,100,'outage edit reached the server');
  assert.equal(storage.data.size,0,'device copy removed after the server stored it');
 });

 await t.test('a device copy that lost a race with another device is kept as a separate score',async()=>{
  const storage=memoryStorage(),device=createLibrary(fetchAs('bo'),{storage});device.reset('bo');
  const score={xml,title:'Shared',trackId:null,bpm:90,offset:0};
  await device.save(score);
  state.down=true;score.bpm=80;await device.save(score).catch(()=>{});device.keepOnDevice(score);state.down=false;
  const other=createLibrary(fetchAs('bo'),{storage:memoryStorage()});other.reset('bo');
  const remote=await other.open(score.libraryId);remote.bpm=120;await other.save(remote);
  const reloaded=createLibrary(fetchAs('bo'),{storage});reloaded.reset('bo');
  await reloaded.save(reloaded.migration().score);
  const titles=(await reloaded.list()).map(s=>s.title).sort();
  assert.deepEqual(titles,['Shared','Shared (this device)']);
  assert.equal((await reloaded.open(score.libraryId)).bpm,120,'the other device keeps its newer copy');
  assert.equal(storage.data.size,0);
 });

 await t.test('full browser storage is reported, never claimed as saved',async()=>{
  const device=createLibrary(fetchAs('cy'),{storage:memoryStorage({full:true})});device.reset('cy');
  state.down=true;
  const score={xml,title:'Nowhere',trackId:null};
  const failure=await device.save(score).catch(e=>e);
  assert.match(failure.message,/not being saved/);
  assert.equal(device.keepOnDevice(score),false);
  state.down=false;
 });

 await t.test('an old-format device score moves once, even when the upload is retried',async()=>{
  const storage=memoryStorage();storage.setItem('score-sing-score-di',JSON.stringify({xml,title:'Legacy'}));
  for(let attempt=0;attempt<2;attempt++){
   const device=createLibrary(fetchAs('di'),{storage});device.reset('di');
   const moved=device.migration().score;
   if(attempt===0){state.down=true;await device.save(moved).catch(()=>{});state.down=false;continue;}
   await device.save(moved);
  }
  assert.equal(rows('di'),'1');assert.equal(storage.data.size,0);
 });
});
