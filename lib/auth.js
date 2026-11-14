import {createRemoteJWKSet,jwtVerify,SignJWT} from 'jose';

export function verifier(config={}, keys) {
  const issuer=config.issuer||config.userPoolId||'score-sing';
  const audience=config.audience||config.clientId||'score-sing';
  const secret=config.secret||process.env.SCORE_SING_AUTH_SECRET||('production'===process.env.NODE_ENV?null:'score-sing-local-dev-secret');

  if(keys){
    const jwks=keys instanceof URL?createRemoteJWKSet(keys,{timeoutDuration:5000,cooldownDuration:30000}):keys;
    return async token=>{
      const {payload}=await jwtVerify(token,jwks,{issuer:issuer==='score-sing'&&config.region&&config.userPoolId?`https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`:issuer,audience,algorithms:['RS256'],requiredClaims:['exp','sub']});
      if(payload.token_use!=='id') throw Error('An app-scoped ID token is required');
      return payload;
    };
  }

  if(!secret) throw Error('No auth secret configured');
  return async token=>{
    const {payload}=await jwtVerify(token,new TextEncoder().encode(secret),{issuer,audience,algorithms:['HS256'],requiredClaims:['exp','sub']});
    if(payload.token_use && payload.token_use!=='id') throw Error('An app-scoped ID token is required');
    return payload;
  };
}

export function issueToken({subject,issuer='score-sing',audience='score-sing',secret=process.env.SCORE_SING_AUTH_SECRET||'score-sing-local-dev-secret',ttlSeconds=60*60*8}={}){
  const now=Math.floor(Date.now()/1000);
  return new SignJWT({sub:String(subject),iss:issuer,aud:audience,iat:now,exp:now+ttlSeconds,token_use:'id'})
    .setProtectedHeader({alg:'HS256',typ:'JWT'})
    .sign(new TextEncoder().encode(secret));
}
