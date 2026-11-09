import {createRemoteJWKSet,jwtVerify} from 'jose';
export function verifier(config, keys) {
 const issuer=`https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
 const jwks=keys||createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`),{timeoutDuration:5000,cooldownDuration:30000});
 return async token=>{
  const {payload}=await jwtVerify(token,jwks,{issuer,audience:config.clientId,algorithms:['RS256'],requiredClaims:['exp','sub']});
  if(payload.token_use!=='id') throw Error('An app-scoped ID token is required');
  return payload;
 };
}
