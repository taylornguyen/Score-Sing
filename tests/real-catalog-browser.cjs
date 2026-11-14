// Real-data check (needs the installed catalog and network): real PDMX scores render and live LRCLIB lyrics time them;
// songs missing from the catalog (Linkin Park's 2024 From Zero) get a words-only score. SONGS=a,b limits the run.
// SCORE_SING_CATALOG_DIR=<catalog> PLAYWRIGHT_BROWSERS_PATH=<dir> node tests/real-catalog-browser.cjs
const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {authScript,startLibrary}=require('./library-fixture.cjs');
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.musicxml':'application/xml'};
const songs=[['Someone Like You','Adele',285000],['Perfect','Ed Sheeran',263000],["Can't Help Falling in Love",'Elvis Presley',182000],['Viva La Vida','Coldplay',242000],['Amazing Grace','Judy Collins',245000],['Fly Me To The Moon','Frank Sinatra',148000],['The Emptiness Machine','Linkin Park',190000],['Two Faced','Linkin Park',183000]];
if(process.env.SONGS)songs.splice(0,songs.length,...songs.filter(s=>process.env.SONGS.split(',').includes(s[0])));
(async()=>{
const {createCatalog,createCatalogHandler}=await import('../lib/catalog.js');
const handle=createCatalogHandler({verify:async token=>{if(!token)throw Error('no token');return {sub:token};},catalog:createCatalog()});
const library=await startLibrary(),browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const results=[];
try{
 for(const [index,[name,artist,duration_ms]] of songs.entries()){
  const context=await browser.newContext({viewport:{width:1280,height:900}});const errors=[];
  const trackId=String(index).repeat(22);
  await context.addInitScript(()=>sessionStorage.setItem('score-sing-spotify',JSON.stringify({access_token:'test-token',clientId:'a'.repeat(32),expiresAt:Date.now()+3600000})));
  await context.route('**/auth.js',r=>r.fulfill({contentType:'text/javascript',body:authScript(`'real${index}'`)}));
  await context.route('https://api.spotify.com/v1/me/player/currently-playing',r=>r.fulfill({json:{currently_playing_type:'track',progress_ms:60000,is_playing:true,item:{id:trackId,name,artists:[{name:artist}],duration_ms}}}));
  await context.route('https://score-sing.test/**',async r=>{
   const u=new URL(r.request().url());const file=path.join(process.cwd(),'frontend',u.pathname==='/'?'index.html':u.pathname);
   try{const body=await fs.readFile(file);await r.fulfill({body,contentType:types[path.extname(file)]||'text/plain'});}catch{await r.fulfill({status:404});}
  });
  await library.route(context);
  await context.route(/^https:\/\/score-sing\.test\/api\/catalog\//,async r=>{
   const u=new URL(r.request().url());let status=200,headers={},chunks=[];
   const res={writeHead:(s,h)=>{status=s;headers=h;},end:b=>chunks.push(Buffer.from(b))};
   await handle({url:u.pathname+u.search,method:'GET',headers:r.request().headers()},res,u.pathname);
   await r.fulfill({status,headers,body:Buffer.concat(chunks)});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://score-sing.test/');
  await page.waitForFunction(()=>/(Found automatically · (timed from lyrics|.*tempo estimate)|Words only · .* · timed from lyrics)$/.test(document.querySelector('#score-subtitle').textContent),null,{timeout:60000}).catch(()=>{});
  const row={song:name,score:await page.locator('#score-title').textContent(),subtitle:await page.locator('#score-subtitle').textContent(),state:await page.locator('#sync-state').textContent(),syllable:await page.locator('#current-syllable').textContent()};
  if(process.env.SHOTS)await page.screenshot({path:path.join(process.env.SHOTS,index+'.png')});
  results.push(row);console.log(JSON.stringify(row));
  assert.deepEqual(errors,[]);
  await context.close();
  await new Promise(r=>setTimeout(r,2500));// LRCLIB rate limit
 }
 assert.ok(results.every(r=>/Found automatically|Words only/.test(r.subtitle)),'every song shows a score');
 const timed=results.filter(r=>r.subtitle.endsWith('timed from lyrics')).length;// words-only scores are timed from lyrics too
 console.log(`real catalog: ${timed}/${results.length} songs timed from lyrics`);
 assert.ok(timed>=results.length-1,'most real songs are timed from their lyrics');
}finally{await browser.close();await library.stop();}
})().catch(e=>{console.error(e);process.exit(1);});
