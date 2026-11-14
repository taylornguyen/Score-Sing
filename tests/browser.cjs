const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {zipSync,strToU8}=require('fflate');
const {authScript,startLibrary}=require('./library-fixture.cjs');
(async()=>{
const library=await startLibrary(),browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
for(const [name,width,height,theme] of [['desktop',1440,1000,'dark'],['iphone',390,844,'dark'],['light',1440,1000,'light']]){
 const context=await browser.newContext({viewport:{width,height},colorScheme:theme});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let progress=12000,playing=true,trackId='1'.repeat(22);
 await page.route('**/auth.js',r=>r.fulfill({contentType:'text/javascript',body:authScript(`'browser-'+${JSON.stringify(name)}`)}));
 await page.route('https://api.spotify.com/v1/me/player/currently-playing',r=>r.fulfill({json:{currently_playing_type:'track',progress_ms:progress,is_playing:playing,item:{id:trackId,name:'Test recording',artists:[{name:'Test artist'}]}}}));
 await context.route('https://score-sing.test/**',async r=>{
  const u=new URL(r.request().url());const file=path.join(process.cwd(),'frontend',u.pathname==='/'?'index.html':u.pathname);
  try{const b=await fs.readFile(file);const ext=path.extname(file);await r.fulfill({body:b,contentType:({'.html':'text/html','.css':'text/css','.js':'text/javascript','.musicxml':'application/xml'})[ext]||'text/plain'});}catch{await r.fulfill({status:404});}
 });
 await library.route(context);
 await page.goto('https://score-sing.test/');
 await page.waitForSelector('#score svg',{timeout:20000});
 await page.waitForFunction(()=>!document.querySelector('#score-file').disabled);
 assert.equal(await page.locator('#sync-state').textContent(),'Score preview · no audio');
 assert.match(await page.locator('#score').textContent(),/Joy/,'first measure and lyrics render');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
 await page.screenshot({path:`tests/${name}.png`,fullPage:true});
 if(name==='desktop'){
  const musicxmlDownload=page.waitForEvent('download');await page.click('#download-musicxml');
  const xmlFile=await musicxmlDownload,xml=await fs.readFile(await xmlFile.path(),'utf8');
  assert.equal(xmlFile.suggestedFilename(),'Ode-to-Joy.musicxml');
  assert.match(xml,/^<\?xml version="1\.0" encoding="UTF-8"\?><score-partwise/);
  await page.evaluate(()=>window.print=()=>{window.__printRequested=true;});
  await page.click('#download-pdf');assert.equal(await page.evaluate(()=>window.__printRequested),true);
  await page.emulateMedia({media:'print'});
  const pdf=await page.pdf({printBackground:true});
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>1000,'print stylesheet produces a score PDF');
  await page.emulateMedia({media:'screen'});
  await page.evaluate(()=>sessionStorage.setItem('score-sing-spotify',JSON.stringify({access_token:'test-token',clientId:'a'.repeat(32),expiresAt:Date.now()+3600000})));
  await page.reload();await page.waitForSelector('#score svg');await page.waitForFunction(()=>document.querySelector('#track-title').textContent==='Test recording');
  await page.setInputFiles('#score-file','frontend/sample.musicxml');await page.waitForFunction(()=>!document.querySelector('#score-file').disabled);
  await page.click('#align-toggle');await page.click('#bind');
  await page.waitForFunction(()=>document.querySelector('#sync-state').textContent==='Following · tempo-based');
  assert.notEqual(await page.locator('#current-note').textContent(),'—');
  assert.match(await page.locator('#current-note').textContent(),/[A-G]/);
  await page.screenshot({path:'tests/following.png',fullPage:true});
  playing=false;progress=5000;await page.waitForFunction(()=>document.querySelector('#sync-state').textContent==='Paused · tempo-based',{timeout:7000});
  trackId='2'.repeat(22);await page.waitForFunction(()=>document.querySelector('#sync-state').textContent==='No score found for this song · keeping this score',{timeout:7000});
  assert.equal(await page.locator('#current-note').textContent(),'—');
  const musicxml=await fs.readFile('frontend/sample.musicxml','utf8');
  const compressed=zipSync({'META-INF/container.xml':strToU8('<container><rootfiles><rootfile full-path="scores/voice.musicxml"/></rootfiles></container>'),'scores/voice.musicxml':strToU8(musicxml)});
  await page.setInputFiles('#score-file',{name:'Compressed vocal.mxl',mimeType:'application/vnd.recordare.musicxml',buffer:Buffer.from(compressed)});
  await page.waitForFunction(()=>!document.querySelector('#score-file').disabled&&document.querySelector('#score-title').textContent==='Compressed vocal');
  assert.match(await page.locator('#score').textContent(),/Joy/);
  await page.setInputFiles('#score-file',{name:'Damaged.mxl',mimeType:'application/vnd.recordare.musicxml',buffer:Buffer.from([1,2,3])});
  await page.waitForFunction(()=>!document.querySelector('#score-file').disabled&&!document.querySelector('#error').hidden);
  assert.match(await page.locator('#error').textContent(),/damaged or unsupported/);
  assert.equal(await page.locator('#score-title').textContent(),'Compressed vocal','bad compressed import retains previous score');

  await page.setInputFiles('#score-file',{name:'timed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schemaVersion:1,musicxml,spotifyTrackId:trackId,title:'Timed score',cues:Array.from({length:30},(_,i)=>i*.5)}))});
  await page.waitForFunction(()=>document.querySelector('#sync-state').textContent==='Paused · timed score');
  assert.equal(await page.locator('#note-position').textContent(),'Position 11 / 30');
  assert.notEqual(await page.locator('#current-syllable').textContent(),'♪');
  assert.equal(await page.locator('#bpm').isDisabled(),true);
  const callbackError=await page.evaluate(async()=>{try{await (await import('/spotify.js')).callback();return '';}catch(e){return e.message;}});
  assert.match(callbackError,/expired or did not match/);
  await page.setInputFiles('#score-file',{name:'broken.musicxml',mimeType:'text/xml',buffer:Buffer.from('<score-partwise><bad>')});
  await page.waitForFunction(()=>!document.querySelector('#error').hidden);
  assert.match(await page.locator('#error').textContent(),/uncompressed partwise/);
 }
 assert.deepEqual(errors,[],name+' page errors');
 console.log(name+': score render, layout, '+(name==='desktop'?'playback/seek/pause/mismatch/import validation, ':'')+'passed');
 if(name==='iphone'){
  await page.evaluate(()=>sessionStorage.removeItem('score-sing-spotify'));await page.reload();await page.waitForSelector('#connect:not([hidden])');
  let authorize=null;await context.route('https://accounts.spotify.com/**',r=>{authorize=new URL(r.request().url());r.fulfill({contentType:'text/html',body:'authorize'});});
  await page.click('#connect');await page.waitForURL(/accounts\.spotify\.com\/authorize/);
  assert.equal(authorize.searchParams.get('client_id'),'283d3d54be16465ca3d51e898f78c037','Connect goes straight to Spotify with the configured client');
  assert.equal(authorize.searchParams.get('redirect_uri'),'https://score-sing.test/callback.html');
 }
 await context.close();
}
}finally{await browser.close();await library.stop();}
})().catch(e=>{console.error(e);process.exit(1);});
