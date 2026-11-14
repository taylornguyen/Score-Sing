import {jwtVerify,SignJWT} from 'jose';
import {createHash,timingSafeEqual} from 'node:crypto';

function signingKey(secret){
  if(typeof secret!=='string'||secret.length<32)throw Error('SCORE_SING_AUTH_SECRET must be at least 32 characters');
  return new TextEncoder().encode(secret);
}

export function verifier({issuer='score-sing',audience='score-sing',secret=process.env.SCORE_SING_AUTH_SECRET}={}){
  const key=signingKey(secret);
  return async token=>{
    const {payload}=await jwtVerify(token,key,{issuer,audience,algorithms:['HS256'],requiredClaims:['exp','sub']});
    if(payload.token_use!=='id')throw Error('A Score Sing session token is required');
    return payload;
  };
}

export function issueToken({subject,issuer='score-sing',audience='score-sing',secret=process.env.SCORE_SING_AUTH_SECRET,ttlSeconds=60*60*8}={}){
  if(typeof subject!=='string'||!subject)throw Error('A session subject is required');
  const now=Math.floor(Date.now()/1000);
  return new SignJWT({sub:subject,iss:issuer,aud:audience,iat:now,exp:now+ttlSeconds,token_use:'id'})
    .setProtectedHeader({alg:'HS256',typ:'JWT'})
    .sign(signingKey(secret));
}

export function passwordMatches(candidate,expected){
  if(typeof candidate!=='string'||typeof expected!=='string')return false;
  const actual=createHash('sha256').update(candidate,'utf8').digest();
  const wanted=createHash('sha256').update(expected,'utf8').digest();
  return timingSafeEqual(actual,wanted);
}
