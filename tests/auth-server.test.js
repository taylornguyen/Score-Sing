import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
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

test('local development startup generates a one-run access code and signing secret',async t=>{
 const port=await unusedPort(),origin=`http://127.0.0.1:${port}`,env={...process.env,PORT:String(port),NODE_ENV:'test'};
 delete env.HOST;delete env.SCORE_SING_LOGIN_PASSWORD;delete env.SCORE_SING_AUTH_SECRET;
 const child=spawn(process.execPath,['server.js'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>output+=chunk);
 t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}});
 let ready=false;
 for(let i=0;i<50&&!ready;i++){
  try{ready=(await fetch(`${origin}/api/login`)).status===405;}catch{}
  if(!ready)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.equal(ready,true,'server starts without credentials when bound to loopback');
 const code=output.match(/Local access code \(this run only\): ([A-Za-z0-9_-]+)/)?.[1];
 assert.match(code||'',/^[A-Za-z0-9_-]{32}$/,'server prints a strong, copyable access code');
 const response=await fetch(`${origin}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:code})});
 assert.equal(response.status,200);
 const {token}=await response.json();
 assert.equal((await fetch(`${origin}/api/session`,{headers:{Authorization:`Bearer ${token}`}})).status,200);
});

test('missing credentials are refused for production or non-loopback hosts',()=>{
 const cwd=fileURLToPath(new URL('..',import.meta.url));
 for(const settings of [{HOST:'0.0.0.0',NODE_ENV:'development'},{HOST:'127.0.0.1',NODE_ENV:'production'}]){
  const env={...process.env,...settings,PORT:'0'};delete env.SCORE_SING_LOGIN_PASSWORD;delete env.SCORE_SING_AUTH_SECRET;
  const result=spawnSync(process.execPath,['server.js'],{cwd,env,encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/SCORE_SING_LOGIN_PASSWORD/);
  assert.doesNotMatch(result.stdout,/Local access code/);
 }
});
