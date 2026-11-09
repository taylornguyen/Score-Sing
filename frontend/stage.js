// Singing stage: a floating always-on-top score (Document Picture-in-Picture) and a
// screen wake lock held only while a score is actively following playback.
export function createStage({content,button,onResize,onMove,onTick,onError}){
 const supported=typeof window.documentPictureInPicture?.requestWindow==='function';
 let pip=null,placeholder=null,opening=false,lock=null,wanted=false,locking=null,resizeTimer;
 button.hidden=!supported;
 function label(){button.textContent=pip?'Return score':'Float score';button.setAttribute('aria-pressed',String(!!pip));}
 function restore(){
  if(!placeholder)return;
  placeholder.replaceWith(content);placeholder=null;pip=null;onMove(null);label();onResize();
 }
 async function open(){
  if(pip||opening)return;opening=true;button.disabled=true;
  try{
   const win=await Promise.race([
    documentPictureInPicture.requestWindow({width:Math.min(520,screen.availWidth||520),height:420}),
    new Promise((_,reject)=>setTimeout(()=>reject(Error('Floating score window did not open')),10000))]);
   // Copy rules synchronously so the moved score never appears unstyled.
   for(const sheet of document.styleSheets){
    try{const style=win.document.createElement('style');style.textContent=[...sheet.cssRules].map(r=>r.cssText).join('\n');win.document.head.append(style);}
    catch{if(sheet.href){const link=win.document.createElement('link');link.rel='stylesheet';link.href=sheet.href;win.document.head.append(link);}}
   }
   win.document.title='Score Sing';win.document.body.className='floating';
   placeholder=document.createComment('floating score');content.replaceWith(placeholder);win.document.body.append(content);pip=win;onMove(win.document);label();
   // The floating window stays visible when the main window is minimized, so it owns the cursor tick.
   win.setInterval(onTick,100);
   win.addEventListener('pagehide',restore,{once:true});
   win.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(onResize,250);});
   onResize();
  }catch(e){onError(e.message||'Floating score window did not open');}
  finally{opening=false;button.disabled=false;}
 }
 function close(){if(pip){const win=pip;restore();win.close();}}
 button.addEventListener('click',()=>pip?close():open());
 label();

 async function sync(){
  if(locking)return;
  const need=wanted&&!document.hidden&&typeof navigator.wakeLock?.request==='function';
  if(need&&!lock){
   locking=navigator.wakeLock.request('screen').then(sentinel=>{
    lock=sentinel;sentinel.addEventListener('release',()=>{if(lock===sentinel)lock=null;},{once:true});
   }).catch(()=>{lock=null;}).finally(()=>{locking=null;if(!!lock!==(wanted&&!document.hidden))sync();});
  }else if(!need&&lock){const sentinel=lock;lock=null;sentinel.release().catch(()=>{});}
 }
 document.addEventListener('visibilitychange',sync);
 return {
  floating:()=>!!pip,
  close,
  awake(on){if(wanted!==!!on){wanted=!!on;sync();}},
  holdingWakeLock:()=>!!lock,
 };
}
