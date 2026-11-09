import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCatalog,createCatalogHandler,songTitle} from '../lib/catalog.js';
const id=n=>'Qm'+String(n).repeat(44).slice(0,44).replace(/0/g,'1');
const entry=(n,fields)=>({id:id(n),song:'',title:'',artist:'',composer:'',views:10,tracks:1,best:true,license:'publicdomain',licenseConflict:false,...fields});
async function fixture(entries){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'catalog-'));await fs.mkdir(path.join(dir,'mxl'));
 await fs.writeFile(path.join(dir,'index.json'),JSON.stringify({schemaVersion:1,entries}));
 for(const e of entries)await fs.writeFile(path.join(dir,'mxl',e.id+'.mxl'),'PK-'+e.id);
 return dir;
}
const entries=[
 entry(2,{song:'Perfect',title:'Perfect - Ed Sheeran',artist:'Ed Sheeran',views:1500,tracks:2}),
 entry(3,{song:'Perfect',title:'Perfect',artist:'Simple Plan',views:90000,tracks:1}),
 entry(4,{song:"Can't Help Falling In Love",title:"Can't Help Falling In Love",artist:'Elvis Presley',views:6900}),
 entry(5,{song:'Amazing Grace',title:'Amazing Grace',artist:'',composer:'American Folk Melody',views:2900}),
 entry(6,{song:'Take Me Home Country Roads',title:'Take Me Home Country Roads',artist:'John Denver',tracks:4}),
 entry(7,{song:'Café del Mar',title:'Café del Mar',artist:'Energy 52'}),
 entry(8,{song:'Let it be now',title:'Let it be now',artist:'Mary L. Stocks'}),
];
test('Spotify version suffixes and features reduce to the song title',()=>{
 assert.equal(songTitle('Yesterday - Remastered 2009'),'yesterday');
 assert.equal(songTitle('Perfect (feat. Beyoncé)'),'perfect');
 assert.equal(songTitle('Take Me Home, Country Roads - Original Version'),'take me home country roads');
 assert.equal(songTitle('Under Pressure - Live at Wembley'),'under pressure');
 assert.equal(songTitle('Don’t Stop Me Now - 2011 Mix'),'dont stop me now');
 assert.equal(songTitle('Bridge Over Troubled Water'),'bridge over troubled water');
});
test('the artist decides between same-titled songs, ahead of popularity',async()=>{
 const catalog=createCatalog({dir:await fixture(entries)});
 const [top,second]=catalog.match({title:'Perfect',artists:['Ed Sheeran']});
 assert.equal(top.id,id(2));assert.equal(top.artistConfirmed,true);assert.equal(second.artistConfirmed,false);
 assert.equal(catalog.match({title:"Can't Help Falling in Love - Remastered",artists:['Elvis Presley']})[0].id,id(4));
 assert.equal(catalog.match({title:'Take Me Home, Country Roads - Original Version',artists:['John Denver']})[0].id,id(6));
 assert.equal(catalog.match({title:'Cafe Del Mar',artists:['Energy 52']})[0].id,id(7));
 assert.deepEqual(catalog.match({title:'Bohemian Rhapsody',artists:['Queen']}),[]);
 assert.deepEqual(catalog.match({title:'Let It Be - Remastered 2009',artists:['The Beatles']}),[],'a near title by another writer is another song');
 assert.equal(catalog.match({title:'Let It Be Now',artists:['Someone']})[0].id,id(8),'an exact title is kept for covers');
 const traditional=catalog.match({title:'Amazing Grace',artists:['Chris Tomlin']})[0];
 assert.equal(traditional.id,id(5));assert.ok(traditional.reasons.includes('artist not listed'));
 assert.equal(catalog.health().entries,entries.length);
 assert.equal((await catalog.file(id(2))).toString(),'PK-'+id(2));
});
test('missing catalog and bad input fail loudly',async()=>{
 const missing=createCatalog({dir:path.join(os.tmpdir(),'no-catalog-here')});
 assert.equal(missing.health().status,'unavailable');
 assert.throws(()=>missing.match({title:'Perfect'}),e=>e.status===503&&/not installed/.test(e.message));
 const catalog=createCatalog({dir:await fixture(entries)});
 assert.throws(()=>catalog.match({title:'  '}),e=>e.status===400);
 await assert.rejects(catalog.file('../index.json'),e=>e.status===400);
 await assert.rejects(catalog.file(id(9)),e=>e.status===404);
});
test('catalog routes require sign-in and only answer GET',async()=>{
 const catalog=createCatalog({dir:await fixture(entries)});
 const handle=createCatalogHandler({catalog,verify:async token=>{if(token!=='ok')throw Error('no');return {sub:'u'};}});
 async function call(url,{token='ok',method='GET'}={}){
  let status,headers,body;const res={writeHead:(s,h)=>{status=s;headers=h;},end:b=>{body=b;}};
  const handled=await handle({url,method,headers:{authorization:'Bearer '+token}},res,new URL(url,'http://x').pathname);
  return {handled,status,headers,body};
 }
 assert.equal((await call('/api/catalog/match?title=Perfect',{token:'bad'})).status,401);
 assert.equal((await call('/api/catalog/match?title=Perfect',{method:'POST'})).status,405);
 const found=await call('/api/catalog/match?title=Perfect&artist=Ed%20Sheeran');
 assert.equal(found.status,200);assert.equal(JSON.parse(found.body).candidates[0].id,id(2));
 const file=await call('/api/catalog/score/'+id(2));
 assert.equal(file.headers['Content-Type'],'application/vnd.recordare.musicxml');
 assert.equal((await call('/api/library')).handled,false);
});
