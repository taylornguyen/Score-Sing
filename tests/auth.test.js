import test from 'node:test';
import assert from 'node:assert/strict';
import {SignJWT} from 'jose';
import {verifier,issueToken,passwordMatches} from '../lib/auth.js';
const secret='a-secure-test-signing-secret-that-is-long-enough';
const localVerify=verifier({secret});
async function signed(changes={}){
 return new SignJWT({sub:'score-sing-owner',iss:'score-sing',aud:'score-sing',exp:Math.floor(Date.now()/1000)+60,token_use:'id',...changes})
  .setProtectedHeader({alg:'HS256',typ:'JWT'}).sign(new TextEncoder().encode(secret));
}
test('local access-code sessions are signed, scoped and expire',async()=>{
 const token=await issueToken({subject:'score-sing-owner',secret,ttlSeconds:60});
 assert.equal((await localVerify(token)).sub,'score-sing-owner');
 await assert.rejects(localVerify(await issueToken({subject:'other',secret:'another-secure-test-signing-secret-long-enough'})));
 await assert.rejects(localVerify(await issueToken({subject:'expired',secret,ttlSeconds:-1})));
 await assert.rejects(localVerify(await issueToken({subject:'wrong-scope',secret,audience:'another-app'})));
 await assert.rejects(localVerify(await signed({iss:'another-issuer'})));
 await assert.rejects(localVerify(await signed({token_use:'access'})));
 await assert.rejects(localVerify(''));
 assert.equal(passwordMatches('correct access code','correct access code'),true);
 assert.equal(passwordMatches('incorrect access code','correct access code'),false);
 assert.equal(passwordMatches(null,'correct access code'),false);
});
test('signed-out page uses only local sign-in assets',async()=>{
 const {readFile}=await import('node:fs/promises');
 const html=await readFile(new URL('../frontend/index.html',import.meta.url),'utf8');
 const landing=html.match(/<main id="signed-out"[\s\S]*?<\/main>/)[0];
 assert.match(landing,/Private access: enter your Score Sing access code\./);
 assert.match(html,/<script defer src="\/auth\.js"><\/script>/);
 assert.doesNotMatch(html,/<script[^>]+src="https?:/);
});
