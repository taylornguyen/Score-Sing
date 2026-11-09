import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLrc,syncedLyrics} from '../frontend/lrclib.js';
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json'}});
test('LRC parsing keeps timed lines in order and skips tags',()=>{
 assert.deepEqual(parseLrc('[ar:Artist]\n[00:12.50] Second\n[00:01.5][00:20.00]Twice\n\n[00:05.123] Third'),
  [{seconds:1.5,text:'Twice'},{seconds:5.123,text:'Third'},{seconds:12.5,text:'Second'},{seconds:20,text:'Twice'}]);
 assert.throws(()=>parseLrc('[00:75.00] bad\n[00:01.00] ok'),/invalid time/);
 assert.throws(()=>parseLrc('[00:01.00] only one'),/too few/);
});
test('exact lookup sends only song metadata and returns synced lines',async()=>{
 const urls=[];globalThis.fetch=async url=>{urls.push(new URL(url));return json({id:7,syncedLyrics:'[00:01.00] a\n[00:02.00] b'});};
 const found=await syncedLyrics({title:'Song',artist:'Band',album:'LP',durationMs:201400});
 assert.equal(found.state,'found');assert.equal(found.source,'LRCLIB #7');assert.equal(found.lines.length,2);
 assert.deepEqual(Object.fromEntries(urls[0].searchParams),{track_name:'Song',artist_name:'Band',album_name:'LP',duration:'201'});
});
test('search fallback picks the closest duration and reports non-synced states',async()=>{
 globalThis.fetch=async url=>url.includes('/get?')?json({},404):json([{id:1,duration:150,syncedLyrics:'[00:01.00] far\n[00:02.00] x'},{id:2,duration:202,syncedLyrics:'[00:01.00] near\n[00:02.00] y'}]);
 assert.equal((await syncedLyrics({title:'S',artist:'A',durationMs:201000})).source,'LRCLIB #2');
 globalThis.fetch=async url=>url.includes('/get?')?json({},404):json([{id:3,instrumental:true}]);
 assert.deepEqual(await syncedLyrics({title:'S',artist:'A'}),{state:'instrumental'});
 globalThis.fetch=async()=>json({id:4,plainLyrics:'words'});
 assert.deepEqual(await syncedLyrics({title:'S',artist:'A'}),{state:'unsynced'});
 globalThis.fetch=async url=>url.includes('/get?')?json({},404):json([]);
 assert.deepEqual(await syncedLyrics({title:'S',artist:'A'}),{state:'missing'});
});
test('service failures and timeouts are visible errors',async()=>{
 globalThis.fetch=async()=>json({},500);
 await assert.rejects(syncedLyrics({title:'S',artist:'A'}),/failed \(500\)/);
 globalThis.fetch=async()=>{throw new DOMException('slow','TimeoutError');};
 await assert.rejects(syncedLyrics({title:'S',artist:'A'}),/timed out/);
 await assert.rejects(syncedLyrics({title:'',artist:'A'}),/required/);
});
