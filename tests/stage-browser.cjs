const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {zipSync,strToU8}=require('fflate');
(async()=>{
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
for(const [name,width,height,theme,pipSupported] of [['desktop',1440,1000,'dark',true],['light',1440,1000,'light',true],['iphone',390,844,'dark',false]]){
 const context=await browser.newContext({viewport:{width,height},colorScheme:theme});
 await context.addInitScript(supported=>{
  window.__locks=[];
  Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{request:async type=>{const s=new EventTarget();s.type=type;s.released=false;s.release=async()=>{if(!s.released){s.released=true;s.dispatchEvent(new Event('release'));}};window.__locks.push(s);return s;}}});
  if(!supported)Object.defineProperty(window,'documentPictureInPicture',{configurable:true,value:undefined});
 },pipSupported);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let progress=12000,playing=true,trackId='1'.repeat(22);
 await page.route('**/auth.js',r=>r.fulfill({contentType:'text/javascript',body:`window.ScoreSignIn={init(o){document.querySelector(o.showWhenLoggedIn).hidden=false;setTimeout(o.onLogin,0);return {fetchWithAuth:async()=>({ok:true,json:async()=>({subject:'browser-fixture'})})}}};`}));
 await page.route('https://api.spotify.com/v1/me/player/currently-playing',r=>r.fulfill({json:{currently_playing_type:'track',progress_ms:progress,is_playing:playing,item:{id:trackId,name:'Test recording',artists:[{name:'Test artist'}]}}}));
 await context.route('https://score-sing.test/**',async r=>{
  const u=new URL(r.request().url());const file=path.join(process.cwd(),'frontend',u.pathname==='/'?'index.html':u.pathname);
  try{const b=await fs.readFile(file);const ext=path.extname(file);await r.fulfill({body:b,contentType:({'.html':'text/html','.css':'text/css','.js':'text/javascript','.musicxml':'application/xml'})[ext]||'text/plain'});}catch{await r.fulfill({status:404});}
 });
 await page.goto('https://score-sing.test/');
 await page.waitForSelector('#score svg',{timeout:20000});
 assert.equal(await page.locator('#float').isVisible(),pipSupported,name+': float control only where Document Picture-in-Picture exists');
 await page.evaluate(()=>sessionStorage.setItem('score-sing-spotify',JSON.stringify({access_token:'test-token',clientId:'a'.repeat(32),expiresAt:Date.now()+3600000})));
 await page.reload();await page.waitForSelector('#score svg');await page.waitForFunction(()=>document.querySelector('#track-title').textContent==='Test recording');
 assert.equal(await page.evaluate(()=>window.__locks.length),0,'no wake lock before following');
 await page.setInputFiles('#score-file','frontend/sample.musicxml');await page.waitForFunction(()=>!document.querySelector('#score-file').disabled);
 await page.click('#align-toggle');await page.click('#bind');
 await page.waitForFunction(()=>document.querySelector('#sync-state').textContent==='Following · tempo-based');
 await page.waitForFunction(()=>window.__locks.some(l=>!l.released),null,{timeout:3000});
 playing=false;await page.waitForFunction(()=>document.querySelector('#sync-state').textContent==='Paused · tempo-based',{timeout:7000});
 assert.equal(await page.evaluate(()=>window.__locks.every(l=>l.released)),true,name+': pause releases the wake lock');
 playing=true;await page.waitForFunction(()=>window.__locks.some(l=>!l.released),null,{timeout:7000});
 if(pipSupported){
  await page.click('#float');
  const pip=fn=>page.evaluate(fn);
  await page.waitForFunction(()=>documentPictureInPicture.window?.document.querySelector('.score-layout #score svg'),null,{timeout:10000});
  assert.equal(await page.locator('#float').textContent(),'Return score');
  assert.equal(await page.locator('.workspace .score-layout').count(),0,'score moved into the floating window');
  const before=await pip(()=>documentPictureInPicture.window.document.querySelector('#note-position').textContent);
  progress+=4000;await page.waitForFunction(b=>documentPictureInPicture.window.document.querySelector('#note-position').textContent!==b,before,{timeout:7000});
  assert.match(await pip(()=>documentPictureInPicture.window.document.querySelector('#current-note').textContent),/[A-G]/,'floating window keeps following');
  const colors=await pip(()=>{const d=documentPictureInPicture.window.document,s=getComputedStyle(d.querySelector('#current-note')),b=getComputedStyle(d.body);return [s.color,b.backgroundColor];});
  assert.notEqual(colors[0],colors[1],'floating note readable');
  assert.equal(await pip(()=>{const w=documentPictureInPicture.window;return w.document.documentElement.scrollWidth<=w.innerWidth;}),true,'floating score fits its window');
  await page.click('#float');
  await page.waitForSelector('.workspace .score-layout #score svg');
  assert.equal(await pip(()=>documentPictureInPicture.window),null);assert.equal(await page.locator('#float').textContent(),'Float score');
  await page.click('#float');await page.waitForFunction(()=>documentPictureInPicture.window?.document.querySelector('#score svg'));
  await page.evaluate(()=>documentPictureInPicture.window.close());
  await page.waitForSelector('.workspace .score-layout #score svg');
  assert.equal(await page.locator('#float').textContent(),'Float score','closing the floating window returns the score');
 }
 await page.click('#disconnect');
 await page.waitForFunction(()=>window.__locks.every(l=>l.released),null,{timeout:3000});
 assert.deepEqual(errors,[],name+' page errors');
 console.log(name+': floating score '+(pipSupported?'open/follow/return/close':'hidden when unsupported')+', wake lock follow/pause/resume/disconnect passed');
 await context.close();
}
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
