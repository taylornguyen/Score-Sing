(()=>{
'use strict';
const KEY='score-sing-auth';
function saved(){
 try{
  const value=JSON.parse(localStorage.getItem(KEY)||'null');
  if(value&&typeof value.token==='string'&&value.token&&Number.isFinite(value.expiresAt)&&value.expiresAt>Date.now())return value;
 }catch{}
 localStorage.removeItem(KEY);return null;
}
function init(o){
 const listeners={login:o.onLogin||(()=>{}),logout:o.onLogout||(()=>{})};
 const el=selector=>selector&&document.querySelector(selector);
 const fail=message=>{const target=el('#auth-error');if(target)target.textContent=message;};
 function render(){
  const session=saved(),inside=el(o.showWhenLoggedIn),outside=el(o.showWhenLoggedOut),header=el(o.headerEl),buttons=el(o.landingButtonsEl);
  if(inside)inside.hidden=!session;if(outside)outside.hidden=!!session;
  if(header){
   header.replaceChildren();
   if(session){
    const who=document.createElement('span');who.className='auth-user';who.textContent='Signed in';
    const signOut=document.createElement('button');signOut.className='quiet';signOut.textContent='Sign out';signOut.addEventListener('click',logout);
    header.append(who,signOut);
   }
  }
  if(buttons){
   buttons.replaceChildren();
   if(!session){
    const form=document.createElement('form');form.className='auth-form';
    const input=document.createElement('input');input.type='password';input.name='password';input.autocomplete='current-password';input.required=true;input.placeholder='Access code';input.setAttribute('aria-label','Score Sing access code');
    const submit=document.createElement('button');submit.className='primary';submit.type='submit';submit.textContent='Sign in';
    form.append(input,submit);form.addEventListener('submit',async event=>{
     event.preventDefault();const password=input.value;input.value='';submit.disabled=true;fail('');
     try{await login(password);}catch(error){fail(error.message);}finally{submit.disabled=false;}
    });buttons.append(form);
   }
  }
  return session;
 }
 async function login(password){
  const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password}),signal:AbortSignal.timeout(10000)});
  let result;try{result=await response.json();}catch{result={};}
  if(!response.ok)throw Error(result.error||`Sign-in failed (${response.status})`);
  if(typeof result.token!=='string'||!Number.isFinite(result.expiresIn)||result.expiresIn<=0||typeof result.subject!=='string')throw Error('Sign-in returned an incomplete session. Try again.');
  const session={token:result.token,expiresAt:Date.now()+result.expiresIn*1000,user:{sub:result.subject}};
  localStorage.setItem(KEY,JSON.stringify(session));render();listeners.login(session.user);
 }
 function logout(){
  localStorage.removeItem(KEY);render();listeners.logout();
 }
 async function getValidToken(){
  const session=saved();if(!session){logout();throw Error('Sign in to Score Sing');}
  return session.token;
 }
 async function fetchWithAuth(url,options={}){
  const response=await fetch(url,{...options,headers:{...(options.headers||{}),Authorization:'Bearer '+await getValidToken()}});
  if(response.status===401){logout();throw Error('Your sign-in expired. Sign in again.');}
  return response;
 }
 addEventListener('storage',event=>{
  if(event.key!==KEY)return;
  const before=!!event.oldValue,now=!!render();
  if(now&&!before)listeners.login(saved().user);else if(!now&&before)listeners.logout();
 });
 const session=render(),ready=Promise.resolve();if(session)queueMicrotask(()=>listeners.login(session.user));
 return {ready,login,logout,getValidToken,fetchWithAuth,getUser:()=>saved()?.user||null,render};
}
window.ScoreSignIn={init};
})();
