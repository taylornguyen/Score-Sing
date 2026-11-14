const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {authScript,startLibrary}=require('./library-fixture.cjs');
(async()=>{
 const library=await startLibrary(),browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 let accounts=0;
 const musicxml=await fs.readFile('frontend/sample.musicxml','utf8');
 const trackId='1'.repeat(22);
 async function fixture({width=1440,theme='dark',saved,delayPreview=false}={}){
  const subject=`alignment-${++accounts}`,key=`score-sing-score-${subject}`;
  const context=await browser.newContext({viewport:{width,height:1000},colorScheme:theme});
  await context.addInitScript(({saved,key,subject})=>{
   window.fixtureSubject??=subject;
   sessionStorage.setItem('score-sing-spotify',JSON.stringify({access_token:'fixture',clientId:'a'.repeat(32),expiresAt:Date.now()+3600000}));
   if(saved!==undefined)localStorage.setItem(key,saved);
  },{saved,key,subject});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let seconds=2,releasePreview;
  await page.route('**/auth.js',r=>r.fulfill({contentType:'text/javascript',body:authScript('window.fixtureSubject')}));
  await page.route('https://api.spotify.com/v1/me/player/currently-playing',r=>r.fulfill({json:{currently_playing_type:'track',progress_ms:seconds*1000,is_playing:false,item:{id:trackId,name:'Fixture recording',artists:[{name:'Fixture artist'}]}}}));
  await page.route('https://score-sing.test/**',async r=>{
   const url=new URL(r.request().url());
   if(url.pathname==='/sample.musicxml'&&delayPreview)await new Promise(resolve=>releasePreview=resolve);
   try{const file=path.join(process.cwd(),'frontend',url.pathname==='/'?'index.html':url.pathname);const body=await fs.readFile(url.pathname==='/spotify.js'&&process.env.SCORE_TRANSPORT?process.env.SCORE_TRANSPORT:file);await r.fulfill({body,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.musicxml':'application/xml'})[path.extname(file)]||'text/plain'});}catch{await r.fulfill({status:404});}
  });
  await library.route(page);
  await page.goto('https://score-sing.test/');
  return {subject,key,page,context,errors,setSeconds:async value=>{seconds=value;await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(value=>document.querySelector('#clock').textContent===`0:${String(value).padStart(2,'0')}`,value);},release:()=>releasePreview?.()};
 }
 async function ready(page){await page.waitForSelector('#score svg',{timeout:20000});await page.waitForFunction(()=>!document.querySelector('#score-file').disabled);}
 async function importXML(page){await page.setInputFiles('#score-file',{name:'Vocal.musicxml',mimeType:'text/xml',buffer:Buffer.from(musicxml)});await page.waitForFunction(()=>document.querySelector('#score-title').textContent==='Vocal');await ready(page);}
 // The newest score in the account's server library, as canonical JSON text (null when empty).
 const stored=subject=>library.sql(`SELECT (jsonb_build_object('xml',musicxml,'trackId',track_id,'title',title)||alignment)::text FROM library_scores WHERE subject='${subject}' ORDER BY updated_at DESC LIMIT 1`)||null;
 async function storedWhen(subject,test){for(let i=0;i<50;i++){const value=stored(subject);if(value&&test(JSON.parse(value)))return value;await new Promise(r=>setTimeout(r,200));}throw Error('Saved score did not reach the library');}
 const local=f=>f.page.evaluate(key=>localStorage.getItem(key),f.key);
 try{
  for(const width of [1440,390])for(const theme of ['dark','light']){
   const f=await fixture({width,theme}),{page}=f;await ready(page);await importXML(page);await page.click('#align-toggle');await page.click('#bind');
   await page.selectOption('#checkpoint-position','0');await page.click('#checkpoint-capture');
   await f.setSeconds(31);await page.selectOption('#checkpoint-position','29');await page.click('#checkpoint-capture');await page.click('#checkpoint-apply');
   await page.waitForFunction(()=>document.querySelector('#sync-state').textContent==='Paused · timed score');
   const aligned=JSON.parse(await storedWhen(f.subject,x=>x.cues?.length===30));assert.equal(aligned.cues.length,30);assert.equal(aligned.cues[0],2);assert.equal(aligned.cues.at(-1),31);assert.equal(aligned.trackId,trackId);
   assert.equal(await page.locator('#bpm').isDisabled(),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'alignment fits viewport');
   if(process.env.ALIGNMENT_SCREENSHOTS)await page.screenshot({path:`${process.env.ALIGNMENT_SCREENSHOTS}-${width}-${theme}.png`,fullPage:true});
   const download=page.waitForEvent('download');await page.click('#alignment-export');const exported=JSON.parse(await fs.readFile(await (await download).path(),'utf8'));
   assert.deepEqual(exported.cues,aligned.cues);assert.equal(exported.musicxml,aligned.xml);
   const before=stored(f.subject),beforeTitle=await page.locator('#score-title').textContent();
   for(const [name,text,pattern] of [['broken.musicxml','<score-partwise><bad>',/uncompressed/],['wrong-count.json',JSON.stringify({...exported,cues:[0,1]}),/each score position/],['bad-marks.json',JSON.stringify({...exported,checkpoints:[{index:0,seconds:2},{index:29,seconds:1}]}),/Checkpoints/],['time-only.musicxml',musicxml.replace('</measure>','<sound time-only="1"/></measure>'),/time-only/]]){
    await page.setInputFiles('#score-file',{name,mimeType:'application/octet-stream',buffer:Buffer.from(text)});await page.waitForFunction(()=>!document.querySelector('#score-file').disabled);await page.waitForFunction(()=>!document.querySelector('#error').hidden);
    assert.match(await page.locator('#error').textContent(),pattern);assert.equal(stored(f.subject),before,'failed import retains saved alignment');assert.equal(await page.locator('#score-title').textContent(),beforeTitle);assert.match(await page.locator('#score').textContent(),/Joy/);assert.equal(await page.locator('#bpm').isDisabled(),true);
   }
   await page.setInputFiles('#score-file',{name:'roundtrip.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...exported,title:'Round trip'}))});await page.waitForFunction(()=>document.querySelector('#score-title').textContent==='Round trip');assert.deepEqual(JSON.parse(await storedWhen(f.subject,x=>x.title==='Round trip')).cues,aligned.cues);
   // A stale renderer must never commit into a signed-out or newly signed-in account.
   await page.evaluate(()=>{const proto=opensheetmusicdisplay.OpenSheetMusicDisplay.prototype,original=proto.load;proto.load=async function(...args){await new Promise(resolve=>window.releaseRender=resolve);return original.apply(this,args);};});
   if(width===1440&&theme==='dark'){
    const beforeTimeout=stored(f.subject);
    await page.setInputFiles('#score-file',{name:'timeout.musicxml',mimeType:'text/xml',buffer:Buffer.from(musicxml)});await page.waitForFunction(()=>!!window.releaseRender);
    await page.waitForFunction(()=>document.querySelector('#error').textContent==='Score rendering timed out',{timeout:18000});
    assert.equal(stored(f.subject),beforeTimeout);assert.equal(await page.locator('#score-title').textContent(),'Round trip');
    await page.evaluate(()=>{window.releaseRender();window.releaseRender=null;});await page.waitForTimeout(500);
    assert.equal(await page.locator('#score-title').textContent(),'Round trip','late timed-out renderer cannot commit');
   }
   await page.setInputFiles('#score-file',{name:'pending.musicxml',mimeType:'text/xml',buffer:Buffer.from(musicxml)});await page.waitForFunction(()=>!!window.releaseRender);
   assert.equal(await page.locator('#score-title').textContent(),'Round trip','pending import preserves visible score');
   const previous=stored(f.subject);await page.evaluate(()=>{fixtureAuth.onLogout();window.releaseRender();});await page.waitForTimeout(500);
   assert.equal(stored(f.subject),previous);assert.equal(await page.locator('#score svg').count(),0,'logout cannot restore a pending score');assert.deepEqual(f.errors,[]);
   console.log(`${width}px ${theme}: checkpoint export/roundtrip, failed-import rollback, logout race passed`);await f.context.close();
  }
  const bad='{invalid saved json',f=await fixture({saved:bad});await ready(f.page);assert.equal(await local(f),bad);assert.match(await f.page.locator('#error').textContent(),/old saved score is unreadable/);assert.equal(stored(f.subject),null);assert.deepEqual(f.errors,[]);await f.context.close();
  const g=await fixture({saved:JSON.stringify({xml:musicxml,cues:[1],trackId})});await ready(g.page);assert.match(await g.page.locator('#error').textContent(),/Saved score could not be restored/);assert.equal(JSON.parse(await local(g)).cues.length,1);assert.equal(stored(g.subject),null,'an unrenderable device score is kept locally, not uploaded');await g.context.close();
  const h=await fixture({delayPreview:true});await h.page.waitForTimeout(250);await importXML(h.page);h.release();await h.page.waitForTimeout(500);assert.equal(await h.page.locator('#score-title').textContent(),'Vocal','late preview cannot overwrite newer import');await storedWhen(h.subject,x=>x.title==='Vocal');assert.equal(library.sql(`SELECT count(*) FROM library_scores WHERE subject='${h.subject}'`),'1','preview is never saved');assert.deepEqual(h.errors,[]);await h.context.close();
  const account=await fixture();await ready(account.page);await importXML(account.page);await account.page.click('#align-toggle');await account.page.click('#bind');
  const oldSaved=await storedWhen(account.subject,x=>x.trackId===trackId);let releasePoll;
  await account.page.route('https://api.spotify.com/v1/me/player/currently-playing',r=>new Promise(resolve=>{releasePoll=async()=>{await r.fulfill({json:{currently_playing_type:'track',progress_ms:2000,is_playing:false,item:{id:trackId,name:'Old account playback',artists:[{name:'Old account'}]}}});resolve();};}));
  await account.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await account.page.waitForTimeout(150);assert.ok(releasePoll,'old account poll is pending');
  await account.page.evaluate(()=>{window.fixtureSubject='other-account';fixtureAuth.onLogin();});
  await account.page.waitForFunction(()=>document.querySelector('#score-title').textContent==='Ode to Joy');
  assert.equal(await account.page.evaluate(()=>sessionStorage.getItem('score-sing-spotify')),null,'account switch disconnects previous Spotify account');
  assert.equal(await account.page.locator('#connect').isVisible(),true);await releasePoll();await account.page.waitForTimeout(300);
  assert.equal(await account.page.locator('#track-title').textContent(),'Connect your music','late prior-account response is ignored');
  assert.equal(stored(account.subject),oldSaved,'prior account score remains saved');assert.equal(stored('other-account'),null,'private score is not copied across accounts');
  assert.equal(await account.page.evaluate(()=>localStorage.getItem('score-sing-score-other-account')),null,'private score is not copied across accounts');assert.deepEqual(account.errors,[]);await account.context.close();
  console.log('corrupt saved state retention, auth/preview import race, and direct account-switch isolation passed');
 }finally{await browser.close();await library.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
