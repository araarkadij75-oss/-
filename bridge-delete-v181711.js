/* MASTER AI 18.17.11 — direct Google delete overlay. */
(function(){
'use strict';
const KEY='MASTER_AI_GOOGLE_DELETE_SENT_V181711';
let done=false;
function loadSeen(){try{return new Set(JSON.parse(localStorage.getItem(KEY)||'[]'))}catch(e){return new Set()}}
function saveSeen(s){try{localStorage.setItem(KEY,JSON.stringify([...s].slice(-1000)))}catch(e){}}
const timer=setInterval(()=>{
  const c=window.MasterAICloud;
  if(done||!c||!c.__quotaSafePatch||typeof c.queueSync!=='function'||typeof c.getGoogle!=='function')return;
  done=true;clearInterval(timer);
  const original=c.queueSync.bind(c),seen=loadSeen();
  c.queueSync=function(orders,deleted,settings,role){
    const out=original(orders,deleted,settings,role);
    if(['owner','dispatcher_logistic'].includes(String(role||''))&&Array.isArray(deleted)){
      const ids=[...new Set(deleted.map(x=>String(x&&x.orderId||'').trim()).filter(Boolean))].filter(id=>!seen.has(id));
      if(ids.length)setTimeout(async()=>{
        try{
          const g=await c.getGoogle(),sid=((String(g.sheetUrl||'').match(/\/d\/([^/]+)/)||[])[1]||'');
          if(!g.bridgeUrl||!g.secret||!sid)return;
          for(const id of ids){
            const r=await fetch(g.bridgeUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'delete',secret:g.secret,spreadsheetId:sid,orderId:id})});
            const j=await r.json();
            if(!r.ok||!j||!j.ok)throw new Error(j&&j.error||('HTTP '+r.status));
            seen.add(id);
          }
          saveSeen(seen);
          if(window.MASTER_AI_QUOTA_SAFE&&window.MASTER_AI_QUOTA_SAFE.diag)window.MASTER_AI_QUOTA_SAFE.diag.directDeletes=(window.MASTER_AI_QUOTA_SAFE.diag.directDeletes||0)+ids.length;
        }catch(e){console.warn('MASTER AI direct Google delete deferred',e)}
      },1700);
    }
    return out;
  };
  c.__directGoogleDeletePatch='18.17.11';
},25);
setTimeout(()=>clearInterval(timer),20000);
})();
