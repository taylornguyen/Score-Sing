// Playing a song with no saved score finds one in the catalog, times it from the recording's synced lyrics and saves it.
const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {zipSync,strToU8}=require('fflate');
const {authScript,startLibrary}=require('./library-fixture.cjs');
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.musicxml':'application/xml'};
const SONG='J'.repeat(22),NO_LYRICS='N'.repeat(22),UNKNOWN='U'.repeat(22),WORDS='W'.repeat(22);
const WRONG='Qm'+'c'.repeat(44),UNSUPPORTED='Qm'+'e'.repeat(44),REPEATED='Qm'+'d'.repeat(44),FIRST='Qm'+'a'.repeat(44),SECOND='Qm'+'b'.repeat(44);
const LRC='[00:10.00] Joyful, joyful, we adore Thee,\n[00:14.00] God of glory, Lord of love;\n[00:18.00] Hearts unfold like flowers before Thee,\n[00:22.00] Hail Thee as the sun above.';
const tracks={
 [SONG]:{name:'Joyful, Joyful - Remastered 2011',artist:'Hymn Singers'},
 [NO_LYRICS]:{name:'Quiet Hymn',artist:'Hymn Singers'},
 [UNKNOWN]:{name:'Nobody Wrote This Down',artist:'Unknown Band'},
 [WORDS]:{name:'Only Words',artist:'New Band'},
};
(async()=>{
const library=await startLibrary(),browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 const errors=[],matches=[],lyricRequests=[];let trackId=SONG,progress=()=>15000;
 await context.addInitScript(()=>sessionStorage.setItem('score-sing-spotify',JSON.stringify({access_token:'test-token',clientId:'a'.repeat(32),expiresAt:Date.now()+3600000})));
 // Shared system audio is a synthetic singer holding A4 (harmonics) over a G2 bass, standing in for the recording.
 await context.addInitScript(()=>{navigator.mediaDevices.getDisplayMedia=async()=>{
  const ctx=new AudioContext(),out=ctx.createMediaStreamDestination();
  const tone=(hz,gain)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=hz;g.gain.value=gain;o.connect(g).connect(out);o.start();};
  for(let h=1;h<=8;h++)tone(440*h,0.12*0.7**(h-1));tone(98,0.2);
  window.sharedAudio=out.stream;return out.stream;
 };});
 await context.route('https://authreturn.com/static/auth_component.js',r=>r.fulfill({contentType:'text/javascript',body:authScript("'singer'")}));
 await context.route('https://api.spotify.com/v1/me/player/currently-playing',r=>r.fulfill({json:{currently_playing_type:'track',progress_ms:progress(),is_playing:true,
  item:{id:trackId,name:tracks[trackId].name,artists:[{name:tracks[trackId].artist}],album:{name:'Hymns'},duration_ms:120000}}}));
 await context.route('https://score-sing.test/**',async r=>{
  const u=new URL(r.request().url());const file=path.join(process.cwd(),'frontend',u.pathname==='/'?'index.html':u.pathname);
  try{const body=await fs.readFile(file);await r.fulfill({body,contentType:types[path.extname(file)]||'text/plain'});}catch{await r.fulfill({status:404});}
 });
 await library.route(context);
 const musicxml=await fs.readFile('frontend/sample.musicxml','utf8');
 const pack=xml=>Buffer.from(zipSync({'META-INF/container.xml':strToU8('<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>'),'score.musicxml':strToU8(xml)}));
 // Same melody with other words: the recording's lyrics rule it out.
 const wrong=pack(musicxml.replace(/<text>[^<]*<\/text>/g,'<text>la</text>'));
 // Pass-specific notes cannot be put in performed order: skipped even without lyrics.
 const unsupported=pack(musicxml.replace('</measure>','<sound time-only="1"/></measure>'));
 // A repeat sign is unfolded into performed order: the first measure plays twice.
 const repeated=pack(musicxml.replace('</measure>','<barline location="right"><repeat direction="backward"/></barline></measure>'));
 const mxl=Buffer.from(zipSync({'META-INF/container.xml':strToU8('<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>'),'score.musicxml':strToU8(musicxml)}));
 await context.route(/^https:\/\/score-sing\.test\/api\/catalog\/match\?/,r=>{
  const u=new URL(r.request().url()),title=u.searchParams.get('title');matches.push({title,artists:u.searchParams.getAll('artist'),auth:r.request().headers().authorization});
  const candidates=title.startsWith('Joyful')?[{id:WRONG,title:'Other words',artist:'Hymn Singers'},{id:FIRST,title:'Hymn to Joy',artist:'Hymn Singers',arranger:'Arr. Test'},{id:SECOND,title:'Ode to Joy (choir)',artist:'Hymn Singers'}]
   :title==='Quiet Hymn'?[{id:UNSUPPORTED,title:'Unsupported Hymn',artist:'Hymn Singers'},{id:REPEATED,title:'Quiet Hymn',artist:'Hymn Singers'}]:[];
  return r.fulfill({json:{candidates}});
 });
 await context.route(/^https:\/\/score-sing\.test\/api\/catalog\/score\/Qm\w+$/,r=>r.fulfill({body:r.request().url().endsWith(WRONG)?wrong:r.request().url().endsWith(REPEATED)?repeated:r.request().url().endsWith(UNSUPPORTED)?unsupported:mxl,contentType:'application/vnd.recordare.musicxml'}));
 await context.route(/^https:\/\/lrclib\.net\/api\//,r=>{
  const u=new URL(r.request().url());lyricRequests.push(u.pathname+u.search);
  if(u.searchParams.get('track_name')==='Only Words')return r.fulfill({json:{id:8,duration:120,syncedLyrics:'[00:12.00] First words we sing\n[00:16.00] Second line arrives'}});
  if(u.searchParams.get('track_name')!=='Joyful, Joyful - Remastered 2011')return r.fulfill({status:404,json:{}});
  return r.fulfill({json:{id:7,duration:120,syncedLyrics:LRC}});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const state=text=>page.waitForFunction(t=>document.querySelector('#sync-state').textContent===t,text,{timeout:15000});
 const text=selector=>page.locator(selector).textContent();
 await page.goto('https://score-sing.test/');

 await state('Following · timed score');
 assert.equal(await text('#score-title'),'Hymn to Joy');
 assert.equal(await text('#score-subtitle'),'Hymn Singers · Arr. Test · Found automatically · timed from lyrics');
 assert.equal(await text('#next-match'),'Try another (2/3)','the top-ranked score with other words was skipped');
 assert.deepEqual(matches[0],{title:'Joyful, Joyful - Remastered 2011',artists:['Hymn Singers'],auth:'Bearer singer'},'catalog search is signed in and names the song');
 assert.ok(lyricRequests.every(r=>!/token|singer/.test(r)),'only song details go to the lyrics service');
 assert.match(await text('#current-syllable'),/\S/);
 const saved=()=>library.sql(`SELECT count(*)||'|'||string_agg(title||':'||(alignment->'catalog'->>'timing')||':'||(alignment ? 'cues'),',') FROM library_scores WHERE subject='singer' AND track_id='${SONG}'`);
 for(let i=0;i<50&&saved()!=='1|Hymn to Joy:lyrics:true';i++)await new Promise(r=>setTimeout(r,100));
 assert.equal(saved(),'1|Hymn to Joy:lyrics:true','found score is saved with its timing and source');

 await page.click('#next-match');
 await page.waitForFunction(()=>document.querySelector('#score-title').textContent==='Ode to Joy (choir)');
 await state('Following · timed score');
 assert.equal(await text('#next-match'),'Try another (3/3)');
 for(let i=0;i<50&&saved()!=='1|Ode to Joy (choir):lyrics:true';i++)await new Promise(r=>setTimeout(r,100));
 assert.equal(saved(),'1|Ode to Joy (choir):lyrics:true','trying another replaces the untouched automatic score');

 trackId=NO_LYRICS;
 await page.waitForFunction(()=>document.querySelector('#score-title').textContent==='Quiet Hymn',null,{timeout:15000});
 await state('Following · tempo-based');
 assert.equal(await text('#score-subtitle'),'Hymn Singers · Found automatically · No synced lyrics for this recording: timing is a tempo estimate');
 assert.equal(await text('#next-match'),'Try another (2/2)','an unsupported score was skipped');
 assert.match(await text('#note-position'),/ \/ 3[4-9]$/,'the repeated first measure is played twice');

 trackId=UNKNOWN;
 await state('No score found for this song · keeping this score');
 assert.equal(await text('#score-title'),'Quiet Hymn');

 trackId=WORDS;
 await page.waitForFunction(()=>document.querySelector('#score-title').textContent==='Only Words',null,{timeout:15000});
 await state('Following · tempo-based');
 assert.equal(await text('#score-subtitle'),'Words only · No score found for this song · timed from lyrics');
 assert.match(await text('#current-note'),/^(Sung|Rest)$/,'no invented pitch');
 assert.match(await text('#score'),/First/);
 assert.equal(await page.locator('#next-match').isHidden(),true);
 assert.equal(library.sql(`SELECT count(*) FROM library_scores WHERE track_id='${WORDS}'`),'0','words-only scores are not stored');

 // Learn notes: listen to the recording from the first word to the end of the lyrics, then stop.
 const started=Date.now();progress=()=>8500+Date.now()-started;
 // Before 0:12 means the playback position has jumped back to before the first word.
 await page.waitForFunction(()=>Number(document.querySelector('#clock').textContent.split(':')[1])<12,null,{timeout:10000});
 await page.click('#learn-notes');
 assert.equal(await text('#score-subtitle'),'Words only · learning notes from the shared audio');
 await page.waitForFunction(()=>/^Stop learning · 7\/7 notes$/.test(document.querySelector('#learn-notes').textContent),null,{timeout:20000});
 await page.click('#learn-notes');
 await page.waitForFunction(()=>document.querySelector('#score-subtitle').textContent==='Words · 7/7 notes estimated from the recording · timed from lyrics',null,{timeout:15000});
 assert.equal(await page.evaluate(()=>window.sharedAudio.getTracks().every(t=>t.readyState==='ended')),true,'listening stops when learning stops');
 assert.equal(await text('#learn-notes'),'Learn notes');
 progress=()=>16200;
 await page.waitForFunction(()=>document.querySelector('#current-note').textContent==='A4',null,{timeout:10000});
 const stored=await page.evaluate(id=>JSON.parse(localStorage.getItem(`score-sing-melody:singer:${id}`)),WORDS);
 assert.equal(stored.key,'First words we sing Second line arrives');
 assert.ok(stored.votes.every(v=>Object.keys(v).length>0),'votes are kept on this device');
 assert.ok(await page.locator('#score svg').count()>0);
 if(process.env.SHOT)await page.screenshot({path:process.env.SHOT});
 progress=()=>15000;

 const searches=matches.length;trackId=SONG;
 await page.waitForFunction(()=>document.querySelector('#score-title').textContent==='Ode to Joy (choir)',null,{timeout:15000});
 await state('Following · timed score');
 assert.equal(await text('#score-subtitle'),'Hymn Singers · Found automatically · timed from lyrics','reopened score keeps its source');
 assert.equal(matches.length,searches,'a saved score opens without searching again');

 trackId=WORDS;
 await page.waitForFunction(()=>document.querySelector('#score-subtitle').textContent==='Words · 7/7 notes estimated from the recording · timed from lyrics',null,{timeout:15000});
 // A corrupted store fails visibly instead of showing a score without its notes.
 await page.evaluate(id=>localStorage.setItem(`score-sing-melody:singer:${id}`,'{'),WORDS);
 trackId=SONG;await page.waitForFunction(()=>document.querySelector('#score-title').textContent==='Ode to Joy (choir)',null,{timeout:15000});
 trackId=WORDS;await state('Automatic score failed: Learned notes for this song are unreadable · keeping this score');

 assert.deepEqual(errors,[]);
 console.log('auto-score: catalog score found, wrong-lyrics and unsupported scores skipped, repeats unfolded, words-only fallback, notes learned from shared audio and kept, timed from lyrics, saved, replaced, tempo fallback, no match, reopened, passed');
}finally{await browser.close();await library.stop();}
})().catch(e=>{console.error(e);process.exit(1);});
