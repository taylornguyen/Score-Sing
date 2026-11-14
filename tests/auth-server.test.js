import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {verifier} from '../lib/auth.js';

async function unusedPort(){
 const server=createServer();
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const {port}=server.address();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 return port;
}

test('local sign-in issues a token accepted by protected APIs',async t=>{
 const port=await unusedPort(),origin=`http://127.0.0.1:${port}`;
 const secret='test-auth-signing-secret-at-least-thirty-two-characters';
 const child=spawn(process.execPath,['server.js'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test',SCORE_SING_LOGIN_PASSWORD:'fixture-access-code-long-enough',SCORE_SING_AUTH_SECRET:secret},stdio:'ignore'});
 t.after(async()=>{
  if(child.exitCode===null){child.kill();await once(child,'exit');}
 });
 let ready=false;
 for(let i=0;i<50&&!ready;i++){
  try{ready=(await fetch(`${origin}/api/login`)).status===405;}catch{}
  if(!ready)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.equal(ready,true,'server starts with the local auth settings');
 const denied=await fetch(`${origin}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'wrong-access-code'})});
 assert.equal(denied.status,401);
 const response=await fetch(`${origin}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'fixture-access-code-long-enough'})});
 assert.equal(response.status,200);
 const {token,subject}=await response.json();
 assert.equal(subject,'score-sing-owner');
 assert.equal((await verifier({secret})(token)).sub,subject);
 const session=await fetch(`${origin}/api/session`,{headers:{Authorization:`Bearer ${token}`}});
 assert.equal(session.status,200);
 assert.deepEqual(await session.json(),{authenticated:true,subject});
 for(let i=0;i<8;i++){
  const failed=await fetch(`${origin}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'wrong-access-code'})});
  assert.equal(failed.status,401);
 }
 const limited=await fetch(`${origin}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'fixture-access-code-long-enough'})});
 assert.equal(limited.status,429);
 assert.ok(Number(limited.headers.get('retry-after'))>0);
});
