import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT} from 'jose';
import {verifier} from '../lib/auth.js';
const config={region:'us-east-1',userPoolId:'test-pool',clientId:'score-sing'};
const issuer='https://cognito-idp.us-east-1.amazonaws.com/test-pool';
const {publicKey,privateKey}=await generateKeyPair('RS256');
const verify=verifier(config,publicKey);
async function sign(changes={}){return new SignJWT({sub:'test-user',token_use:'id',iss:issuer,aud:config.clientId,exp:Math.floor(Date.now()/1000)+60,...changes}).setProtectedHeader({alg:'RS256'}).sign(privateKey);}
test('app-scoped signed ID token works',async()=>assert.equal((await verify(await sign())).sub,'test-user'));
test('wrong app, issuer, expiry, token-use and missing auth fail closed',async()=>{
 for(const changes of [{aud:'another-app'},{iss:'https://attacker.example'},{exp:1},{token_use:'access'}])await assert.rejects(verify(await sign(changes)));
 await assert.rejects(verify(''));await assert.rejects(verify('invalid.jwt.value'));
});
test('signed-out page says sign-up is invite only',async()=>{
 const {readFile}=await import('node:fs/promises');
 const landing=(await readFile(new URL('../frontend/index.html',import.meta.url),'utf8')).match(/<main id="signed-out"[\s\S]*?<\/main>/)[0];
 assert.match(landing,/Invite only: sign up with your approved email\./);
});
