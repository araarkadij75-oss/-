/* MASTER AI 18.17.11 — Spark quota-safe realtime patch.
   Loaded synchronously from cloud-config.js before the embedded cloud adapter.
   No production endpoints, no billing, no secrets. */
(function(){
  'use strict';
  const PATCH='18.17.11-quota-safe';
  const DB_NAME='master_ai_orders_v4', STORE='kv', KEY='app';
  const TECH_RE=/^(?:BETA-E2E-|INTEG-E2E-|BRIDGE-SELFTEST-)/;
  let cloudValue=null;

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function readCache(){
    return new Promise(resolve=>{
      try{
        const q=indexedDB.open(DB_NAME,1);
        q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains(STORE))q.result.createObjectStore(STORE)};
        q.onerror=()=>resolve(null);
        q.onsuccess=()=>{
          try{
            const db=q.result,tx=db.transaction(STORE,'readonly'),g=tx.objectStore(STORE).get(KEY);
            g.onsuccess=()=>resolve(g.result||null);
            g.onerror=()=>resolve(null);
          }catch(e){resolve(null)}
        };
      }catch(e){resolve(null)}
    });
  }
  function isoCursor(rows){
    let mx=0;
    for(const r of rows||[]){
      const t=Date.parse(String(r&&r._updatedAt||''));
      if(Number.isFinite(t)&&t>mx)mx=t;
    }
    return mx?new Date(Math.max(0,mx-300000)).toISOString():'';
  }
  function validRows(rows,deleted){
    const dead=new Set((deleted||[]).map(x=>String(x&&x.orderId||'').trim()).filter(Boolean));
    return (Array.isArray(rows)?rows:[]).filter(r=>{
      const id=String(r&&r.orderId||'').trim();
      return id&&!TECH_RE.test(id)&&!dead.has(id);
    });
  }
  function sheetId(url){const m=String(url||'').match(/\/d\/([^/]+)/);return m?m[1]:''}

  function armCloudObject(cloud){
    if(!cloud||cloud.__quotaBootArmed)return;
    cloud.__quotaBootArmed=true;
    let boot;
    Object.defineProperty(cloud,'bootPromise',{
      configurable:true,
      enumerable:true,
      get(){return boot},
      set(p){
        boot=Promise.resolve(p).then(async value=>{
          try{await installPatch(cloud)}catch(e){console.error('MASTER AI quota-safe patch',e)}
          return value;
        });
      }
    });
  }

  async function installPatch(cloud){
    if(!cloud||cloud.__quotaSafePatch===PATCH)return;
    const cfg=window.MASTER_AI_CLOUD_CONFIG||{};
    if(!cfg.enabled||!cfg.firebaseConfig||cfg.firebaseConfig.projectId!=='master-ai-beta-9440599'||cfg.workspaceId!=='master-ai-beta'){
      throw new Error('quota-safe patch refused: unexpected staging target');
    }
    const appMod=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js');
    const fs=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
    let app=(appMod.getApps&&appMod.getApps().find(a=>a.options&&a.options.projectId===cfg.firebaseConfig.projectId))||null;
    if(!app)app=appMod.initializeApp(cfg.firebaseConfig,'quota_safe_'+Date.now());
    const db=fs.getFirestore(app),ws=cfg.workspaceId;
    const ordersCol=fs.collection(db,'workspaces',ws,'orders');
    const googleRef=fs.doc(db,'workspaces',ws,'config','google');

    const originalSubscribe=cloud.subscribe&&cloud.subscribe.bind(cloud);
    const originalRequest=cloud.requestGoogleSync&&cloud.requestGoogleSync.bind(cloud);
    const originalQueue=cloud.queueSync&&cloud.queueSync.bind(cloud);
    const originalHealth=cloud.integrationHealth&&cloud.integrationHealth.bind(cloud);

    const diag=cloud.quotaSafeDiag={patch:PATCH,mode:'pending',cacheRows:0,deltaReads:0,deltaEvents:0,bridgePushes:0,bridgeDeletes:0,bridgeErrors:0,fullPulls:0,fullPullSkips:0,lastBridgeError:'',lastCursor:'',installedAt:new Date().toISOString()};
    let googleCfg={},googleUnsub=null,pullTimer=null,pushTimer=null;
    const pushRows=new Map(),pushDeletes=new Map(),knownDeleted=new Set();

    async function refreshGoogleCfg(){
      try{
        const d=await fs.getDoc(googleRef);
        googleCfg=d.exists()?d.data():{};
        return googleCfg;
      }catch(e){return googleCfg||{}}
    }
    function applyTombstones(cacheMap,x){
      const all=[...(Array.isArray(x&&x.deletedOrders)?x.deletedOrders:[]),...(Array.isArray(x&&x.deletedHistory)?x.deletedHistory:[])];
      let changed=false;
      for(const t of all){
        const id=String(t&&t.orderId||'').trim();
        if(id){knownDeleted.add(id);if(cacheMap.delete(id))changed=true}
      }
      return changed;
    }
    async function bridgePost(payload){
      const g=(googleCfg&&googleCfg.bridgeUrl)?googleCfg:await refreshGoogleCfg();
      if(!g.bridgeUrl||!g.secret)throw new Error('Google Bridge не настроен');
      const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),45000);
      try{
        const r=await fetch(g.bridgeUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),signal:ac.signal});
        const txt=await r.text();let j;
        try{j=JSON.parse(txt)}catch(e){throw new Error('Google Bridge вернул не-JSON ответ')}
        if(!r.ok)throw new Error('Google Bridge HTTP '+r.status);
        if(!j||!j.ok)throw new Error(j&&j.error||'Google Bridge error');
        return j;
      }finally{clearTimeout(timer)}
    }
    function enqueueBridgeRows(rows){
      for(const r of rows||[]){
        const id=String(r&&r.orderId||'').trim();
        if(id&&!TECH_RE.test(id))pushRows.set(id,{...r});
      }
      scheduleBridgeFlush();
    }
    function enqueueBridgeDeletes(items){
      for(const x of items||[]){
        const id=String(x&&x.orderId||'').trim();
        if(id){const d={orderId:id,deletedAt:String(x.deletedAt||new Date().toISOString()),source:'crm'};pushDeletes.set(id,d);knownDeleted.add(id)}
      }
      scheduleBridgeFlush();
    }
    function scheduleBridgeFlush(){
      clearTimeout(pushTimer);
      pushTimer=setTimeout(flushBridge,1200);
    }
    async function flushBridge(){
      const rows=[...pushRows.values()],deleted=[...pushDeletes.values()];
      if(!rows.length&&!deleted.length)return;
      pushRows.clear();pushDeletes.clear();
      try{
        const g=(googleCfg&&googleCfg.bridgeUrl)?googleCfg:await refreshGoogleCfg();
        await bridgePost({action:'merge',secret:g.secret,spreadsheetId:sheetId(g.sheetUrl),orders:rows,members:[],audit:[],deleted,source:{app:'MASTER AI',build:PATCH,reason:'delta_push'}});
        diag.bridgePushes+=rows.length;diag.bridgeDeletes+=deleted.length;diag.lastBridgeError='';
      }catch(e){
        diag.bridgeErrors++;diag.lastBridgeError=String(e&&e.message||e).slice(0,500);
        for(const r of rows)pushRows.set(String(r.orderId),r);
        for(const d of deleted)pushDeletes.set(String(d.orderId),d);
        console.warn('quota-safe bridge delta deferred',e);
      }
    }
    async function rememberDeletes(items){
      const fresh=[];
      for(const x of items||[]){
        const id=String(x&&x.orderId||'').trim();
        if(id&&!knownDeleted.has(id)){knownDeleted.add(id);fresh.push({orderId:id,deletedAt:String(x.deletedAt||new Date().toISOString()),source:'crm'})}
      }
      if(!fresh.length)return;
      try{
        const g=(googleCfg&&Object.keys(googleCfg).length)?googleCfg:await refreshGoogleCfg();
        const hist=new Map((Array.isArray(g.deletedHistory)?g.deletedHistory:[]).map(x=>[String(x&&x.orderId||''),x]).filter(x=>x[0]));
        fresh.forEach(x=>hist.set(x.orderId,x));
        const deletedHistory=[...hist.values()].slice(-2000);
        await fs.setDoc(googleRef,{deletedHistory,lastDeleteHistoryAt:new Date().toISOString()},{merge:true});
        googleCfg={...g,deletedHistory};
      }catch(e){console.warn('delete history deferred',e)}
    }
    async function maybeFullPull(reason,force){
      if(!originalRequest||!cloud.connected||!['owner','dispatcher_logistic'].includes(cloud.profile&&cloud.profile.role))return null;
      const g=(googleCfg&&Object.keys(googleCfg).length)?googleCfg:await refreshGoogleCfg();
      const last=Date.parse(String(g.lastSuccessAt||'')),fresh=Number.isFinite(last)&&(Date.now()-last)<15*60*1000;
      if(!force&&fresh){diag.fullPullSkips++;return null}
      diag.fullPulls++;
      return originalRequest(reason||'quota_safe_pull');
    }

    cloud.subscribe=function(profile,onRows){
      const role=String(profile&&profile.role||'');
      if(!['owner','dispatcher_logistic','logistic'].includes(role)||!originalSubscribe)return originalSubscribe?originalSubscribe(profile,onRows):null;
      try{cloud.unsub&&cloud.unsub()}catch(e){}
      try{googleUnsub&&googleUnsub()}catch(e){}
      if(cloud.googlePeriodicTimer){clearInterval(cloud.googlePeriodicTimer);cloud.googlePeriodicTimer=null}
      return (async()=>{
        const cached=await readCache();
        const cachedRows=validRows(cached&&cached.orders,cached&&cached.deletedOrders);
        if(cachedRows.length<500){
          diag.mode='bootstrap_full';diag.cacheRows=cachedRows.length;
          return originalSubscribe(profile,onRows);
        }
        const cacheMap=new Map(cachedRows.map(r=>[String(r.orderId),{...r}]));
        const cursor=isoCursor(cachedRows);
        if(!cursor){diag.mode='bootstrap_full_no_cursor';return originalSubscribe(profile,onRows)}
        diag.mode='delta';diag.cacheRows=cacheMap.size;diag.lastCursor=cursor;
        cloud.ownerRows=[...cacheMap.values()];cloud.ownerSeenReady=true;
        cloud.versions.clear();for(const r of cacheMap.values())cloud.versions.set(String(r.orderId),String(r._updatedAt||''));
        onRows([...cacheMap.values()]);

        googleUnsub=fs.onSnapshot(googleRef,d=>{
          googleCfg=d.exists()?d.data():{};
          if(applyTombstones(cacheMap,googleCfg)){
            cloud.ownerRows=[...cacheMap.values()];
            onRows(cloud.ownerRows);
          }
        },e=>console.warn('quota-safe google state',e));

        const q=fs.query(ordersCol,fs.where('_updatedAt','>=',cursor));
        let initial=true;
        cloud.unsub=fs.onSnapshot(q,snap=>{
          const changedRows=[];
          diag.deltaReads+=snap.size;diag.deltaEvents+=snap.docChanges().length;
          for(const ch of snap.docChanges()){
            const id=String(ch.doc.id),row={...ch.doc.data(),_cloudDocId:id};
            if(TECH_RE.test(id)||knownDeleted.has(id)){cacheMap.delete(id);continue}
            if(ch.type==='removed'){cacheMap.delete(id);cloud.versions.delete(id)}
            else{cacheMap.set(id,row);cloud.versions.set(id,String(row._updatedAt||''));if(!initial)changedRows.push(row)}
          }
          cloud.ownerRows=[...cacheMap.values()];cloud.ownerSeenReady=true;
          onRows(cloud.ownerRows);
          if(!initial&&['owner','dispatcher_logistic'].includes(role)&&changedRows.length)enqueueBridgeRows(changedRows);
          initial=false;
        },err=>{
          console.warn('quota-safe delta realtime',err);
          if(cacheMap.size){window.MasterAICloudStatus&&window.MasterAICloudStatus('warn','Работа из сохранённого снимка · облачная квота временно недоступна');onRows([...cacheMap.values()])}
          else window.MasterAICloudStatus&&window.MasterAICloudStatus('error','Ошибка real-time: '+String(err&&err.message||err));
        });

        if(['owner','dispatcher_logistic'].includes(role)){
          setTimeout(()=>maybeFullPull('quota_safe_open',false).catch(e=>console.warn('quota-safe open pull',e)),4000);
          pullTimer=setInterval(()=>maybeFullPull('quota_safe_periodic',false).catch(e=>console.warn('quota-safe periodic pull',e)),15*60*1000);
          if(!cloud.__quotaFocusBound){
            const focus=()=>{if(document.visibilityState==='visible')maybeFullPull('quota_safe_focus',false).catch(e=>console.warn('quota-safe focus pull',e))};
            window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);cloud.__quotaFocusBound=true;
          }
        }
        return cloud.unsub;
      })();
    };

    if(originalQueue){
      cloud.queueSync=function(orders,deleted,settings,role){
        const ret=originalQueue(orders,deleted,settings,role);
        if(['owner','dispatcher_logistic'].includes(String(role||''))&&Array.isArray(deleted)&&deleted.length){
          const ds=deleted.map(x=>({orderId:String(x&&x.orderId||''),deletedAt:String(x&&x.deletedAt||new Date().toISOString()),source:'crm'})).filter(x=>x.orderId);
          rememberDeletes(ds);enqueueBridgeDeletes(ds);
        }
        return ret;
      };
    }

    if(originalHealth){
      cloud.integrationHealth=async function(){
        const h=await originalHealth();
        h.version='18.17.11 Spark';
        h.syncState={...(h.syncState||{}),quotaSafeReads:true,deltaRealtime:diag.mode==='delta',deltaCursor:diag.lastCursor,cacheRows:diag.cacheRows,deltaReads:diag.deltaReads,bridgeDeltaPushes:diag.bridgePushes,bridgeDeltaDeletes:diag.bridgeDeletes,periodicPullMinutes:15,patch:PATCH};
        return h;
      };
    }

    cloud.__quotaSafePatch=PATCH;
    window.MASTER_AI_QUOTA_SAFE={version:PATCH,diag,forcePull:()=>maybeFullPull('quota_safe_manual',true),flush:flushBridge};
    window.MASTER_AI_BUILD='18.17.11-CANDIDATE';
    console.info('MASTER AI quota-safe patch installed',PATCH);
  }

  Object.defineProperty(window,'MasterAICloud',{
    configurable:true,
    enumerable:true,
    get(){return cloudValue},
    set(v){cloudValue=v;armCloudObject(v)}
  });
})();
