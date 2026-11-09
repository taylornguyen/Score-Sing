const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {authScript,startLibrary}=require('./library-fixture.cjs');
const T1='1'.repeat(22),T2='2'.repeat(22),T3='3'.repeat(22);
(async()=>{
const library=await startLibrary(),browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const musicxml=await fs.readFile('frontend/sample.musicxml','utf8');
const spotify={trackId:T1,progress:12000};
async function open(name,{width,height,theme,subject='listener'}){
 const context=await browser.newContext({viewport:{width,height},colorScheme:theme});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('https://authreturn.com/static/auth_component.js',r=>r.fulfill({contentType:'text/javascript',body:authScript(`window.fixtureSubject||${JSON.stringify(subject)}`)}));
 await context.route('https://api.spotify.com/v1/me/player/currently-playing',r=>r.fulfill({json:{currently_playing_type:'track',progress_ms:spotify.progress,is_playing:true,item:{id:spotify.trackId,name:'Recording '+spotify.trackId[0],artists:[{name:'Fixture artist'}]}}}));
 await context.route('https://score-sing.test/**',async r=>{
  const u=new URL(r.request().url());const file=path.join(process.cwd(),'frontend',u.pathname==='/'?'index.html':u.pathname);
  try{const b=await fs.readFile(file);await r.fulfill({body:b,contentType:({'.html':'text/html','.css':'text/css','.js':'text/javascript','.musicxml':'application/xml'})[path.extname(file)]||'text/plain'});}catch{await r.fulfill({status:404,json:{}});}
 });
 await library.route(context);
 await page.goto('https://score-sing.test/');await page.waitForSelector('#score svg',{timeout:20000});
 return {context,page,errors,name};
}
const eventually=async(read,expected,label)=>{for(let i=0;i<50;i++){if(read()===expected)return;await new Promise(r=>setTimeout(r,200));}assert.equal(read(),expected,label);};
const settled=page=>page.waitForFunction(()=>!document.querySelector('#score-file').disabled);
const status=(page,text,timeout=9000)=>page.waitForFunction(t=>document.querySelector('#sync-state').textContent===t,text,{timeout});
const title=(page,text,timeout=9000)=>page.waitForFunction(t=>document.querySelector('#score-title').textContent===t,text,{timeout});
const connect=async page=>{await page.evaluate(()=>sessionStorage.setItem('score-sing-spotify',JSON.stringify({access_token:'fixture',clientId:'a'.repeat(32),expiresAt:Date.now()+3600000})));await page.reload();await page.waitForSelector('#score svg');};
async function check({page,errors,name}){
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' no horizontal overflow');
 const switcher=page.locator('#score-library');
 if(await switcher.count()){
  const colors=await switcher.evaluate(el=>{const s=getComputedStyle(el);return [s.color,s.backgroundColor];});
  assert.notEqual(colors[0],colors[1],name+' switcher text is readable');
 }
 assert.deepEqual(errors,[],name+' page errors');
}
try{
 // Windows-size desktop, dark: the old browser-local score moves into the account library.
 const win=await open('windows',{width:1440,height:1000,theme:'dark'});
 await win.page.evaluate(xml=>localStorage.setItem('score-sing-score-listener',JSON.stringify({xml,title:'Windows aligned',trackId:'1111111111111111111111',bpm:96,offset:1})),musicxml);
 await win.page.reload();await title(win.page,'Windows aligned');await settled(win.page);
 await win.page.waitForFunction(()=>!localStorage.getItem('score-sing-score-listener')&&!localStorage.getItem('score-sing-score-move-listener'));
 assert.equal(library.sql("SELECT title||'|'||track_id||'|'||(alignment->>'bpm') FROM library_scores WHERE subject='listener'"),`Windows aligned|${T1}|96`,'migrated score with its binding and tempo');
 await connect(win.page);await title(win.page,'Windows aligned');await status(win.page,'Following · tempo-based');

 spotify.trackId=T2;
 await status(win.page,'No score found for this song · keeping this score');
 assert.equal(await win.page.locator('#score-title').textContent(),'Windows aligned','unbound song keeps the current score');
 assert.equal(await win.page.locator('#score-library').count(),0,'no switcher with a single saved score');

 await win.page.setInputFiles('#score-file',{name:'Second song.musicxml',mimeType:'text/xml',buffer:Buffer.from(musicxml)});
 await title(win.page,'Second song');await settled(win.page);
 await win.page.waitForFunction(()=>document.querySelectorAll('#score-library option').length===2);
 await win.page.click('#align-toggle');await win.page.click('#bind');
 await status(win.page,'Following · tempo-based');
 await eventually(()=>library.sql(`SELECT title FROM library_scores WHERE subject='listener' AND track_id='${T2}'`),'Second song','binding saved to the server');

 spotify.trackId=T1;await title(win.page,'Windows aligned');await status(win.page,'Following · tempo-based');
 spotify.trackId=T2;await title(win.page,'Second song');await status(win.page,'Following · tempo-based');
 await win.page.screenshot({path:'tests/library-windows.png',fullPage:true});
 await check(win);

 // iPhone-size, light, a different browser profile: the same library appears and follows the playing song.
 spotify.trackId=T1;
 const phone=await open('iphone',{width:390,height:844,theme:'light'});
 await connect(phone.page);await title(phone.page,'Windows aligned');await status(phone.page,'Following · tempo-based');
 await phone.page.selectOption('#score-library',{label:'Second song'});
 await title(phone.page,'Second song');
 spotify.trackId=T3;await status(phone.page,'No score found for this song · keeping this score');
 await phone.page.screenshot({path:'tests/library-iphone.png',fullPage:true});
 await check(phone);

 // Another account sees none of these scores.
 const stranger=await open('stranger',{width:1440,height:1000,theme:'light',subject:'stranger'});
 await settled(stranger.page);
 assert.equal(await stranger.page.locator('#score-title').textContent(),'Ode to Joy');
 assert.equal(await stranger.page.locator('#score-library').count(),0);
 const anonymous=await stranger.page.evaluate(async()=>(await fetch('/api/library',{signal:AbortSignal.timeout(10000)})).status);
 assert.equal(anonymous,401,'signed-out library request is refused');
 await check(stranger);

 // Storage outage: failures are visible and the device copy is not discarded.
 library.state.down=true;
 await stranger.page.setInputFiles('#score-file',{name:'Offline.musicxml',mimeType:'text/xml',buffer:Buffer.from(musicxml)});
 await title(stranger.page,'Offline');
 await stranger.page.waitForFunction(()=>document.querySelector('#error').textContent==='Score library is unavailable. Saved on this device only.');
 assert.equal(await stranger.page.evaluate(()=>JSON.parse(localStorage.getItem('score-sing-score-stranger')).title),'Offline','new import kept on this device while storage is down');
 await stranger.page.reload();await title(stranger.page,'Offline');await settled(stranger.page);
 await stranger.page.evaluate(xml=>localStorage.setItem('score-sing-score-stranger',JSON.stringify({xml,title:'Device only'})),musicxml);
 await stranger.page.reload();await title(stranger.page,'Device only');await settled(stranger.page);
 await stranger.page.waitForFunction(()=>/unavailable/.test(document.querySelector('#error').textContent));
 assert.ok(await stranger.page.evaluate(()=>localStorage.getItem('score-sing-score-stranger')),'device copy kept while storage is down');
 library.state.down=false;
 await stranger.page.reload();await title(stranger.page,'Device only');
 await stranger.page.waitForFunction(()=>!localStorage.getItem('score-sing-score-stranger'));
 await eventually(()=>library.sql("SELECT string_agg(title,',') FROM library_scores WHERE subject='stranger'"),'Device only','moved once storage returned');
 assert.equal(library.sql("SELECT count(*) FROM library_scores WHERE subject='listener'"),'2');
 for(const view of [win,phone,stranger])await view.context.close();
 console.log('library: migration, cross-device sync, song auto-switch, switcher, account isolation, 401 and outage checks passed (1440 dark, 390 light)');
}finally{await browser.close();await library.stop();}
})().catch(e=>{console.error(e);process.exit(1);});
