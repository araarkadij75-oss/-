/* MASTER AI 18.17.13 — Spark quota-safe realtime patch.
   Loaded synchronously from cloud-config.js before the embedded cloud adapter.
   No production endpoints, no billing, no secrets. */
(function(){
  'use strict';
  const PATCH='18.17.13-quota-safe';
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

    const diag=cloud.quotaSafeDiag={patch:PATCH,mode:'pending',cacheRows:0,deltaReads:0,deltaEvents:0,bridgePushes:0,bridgeDeletes:0,bridgeErrors:0,fullPulls:0,fullPullSkips:0,lastBridgeError:'',lastBridgeSuccessAt:'',lastCursor:'',recoveredDirty:0,recoverySkipped:0,lockDeferrals:0,deltaRetryCount:0,deltaDeadLetter:false,lastFlush:null,installedAt:new Date().toISOString()};
    let googleCfg={},googleUnsub=null,pullTimer=null,pushTimer=null,bridgeFlushing=false,bridgeRetryAttempt=0,baselineMap={},tombstoneSnapshotReady=false;
    const pushRows=new Map(),pushDeletes=new Map(),knownDeleted=new Set();
    const GOOGLE_KEYS=['orderId','_status','direction','city','callDate','callTime','visitDate','visitTime','name','phone','address','request','master','dispatcher','_assignedByName','_createdByShift','pp','parts','cleanCheck','total','masterAmount','companyShare','review','closeDate','_masterStage','_acceptedAt','_enrouteAt','_arrivedAt','_workAt','_doneAt','_cashReceivedAt','_workflow','_workflowCreatedAt','_requiresCloseApproval','_closeReviewState','_reviewSubmittedAt','_workCompletedAt','_reviewReturnedAt','_reviewReturnedByName','_closeReviewNote','_closeApprovedAt','_closeApprovedByName'];
    const DAY_KEYS=new Set(['callDate','visitDate','closeDate']),TIME_KEYS=new Set(['callTime','visitTime']),NUMBER_KEYS=new Set(['pp','parts','cleanCheck','total','masterAmount','companyShare','_masterReportedTotal','_masterReportedParts']),BOOL_KEYS=new Set(['_requiresCloseApproval','_showPhoneToMaster','_masterReportedReview']);
    function fnv(v){let h=2166136261>>>0;for(const ch of String(v)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return h.toString(16).padStart(8,'0')}
    function day(v){if(v==null||v==='')return'';if(typeof v==='number'&&v>20000&&v<90000){const d=new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000);return d.toISOString().slice(0,10)}const x=String(v).trim();if(/^\d{4}-\d{2}-\d{2}$/.test(x))return x;if(/^\d{4}-\d{2}-\d{2}T/.test(x)){const d=new Date(x);if(Number.isFinite(d.getTime())){try{const p=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d),o=Object.fromEntries(p.map(z=>[z.type,z.value]));return o.year+'-'+o.month+'-'+o.day}catch(e){}}}const m=x.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[1]+'-'+m[2]+'-'+m[3]:x}
    function tm(v){if(v==null||v==='')return'';if(typeof v==='number'&&v>=0&&v<1){const mins=Math.round(v*1440)%1440;return String(Math.floor(mins/60)).padStart(2,'0')+':'+String(mins%60).padStart(2,'0')}const x=String(v).trim(),m=x.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);if(m)return String(Number(m[1])).padStart(2,'0')+':'+m[2];if(/^\d{4}-\d{2}-\d{2}T/.test(x)){const d=new Date(x);if(Number.isFinite(d.getTime())){try{const p=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d),o=Object.fromEntries(p.map(z=>[z.type,z.value]));return o.hour+':'+o.minute}catch(e){}}}return x}
    function cv(k,v){if(v==null||v==='')return'';if(DAY_KEYS.has(k))return day(v);if(TIME_KEYS.has(k))return tm(v);if(NUMBER_KEYS.has(k)){const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?String(Math.round(n*1000000)/1000000):String(v).trim()}if(BOOL_KEYS.has(k)){const x=String(v).trim().toLowerCase();return ['true','1','да','yes'].includes(x)?'1':['false','0','нет','no',''].includes(x)?'0':x}if(typeof v==='object'){try{return JSON.stringify(v)}catch(e){return String(v)}}return String(v).replace(/\r\n/g,'\n').trim()}
    function rowHash(r){r=r||{};return fnv(GOOGLE_KEYS.map(k=>k+'='+cv(k,r[k])).join('\u001f'))}
    function safeBaseline(x){if(!x||typeof x!=='object'||Array.isArray(x))return{};const o={};let n=0;for(const [id,h] of Object.entries(x)){if(n++>50000)break;if(id&&typeof h==='string')o[id]=h}return o}

    async function refreshGoogleCfg(){
      try{
        const d=await fs.getDoc(googleRef);
        googleCfg=d.exists()?d.data():{};
        baselineMap=safeBaseline(googleCfg.syncBaseline);
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
      for(const r0 of rows||[]){
        const r={...(r0||{})},id=String(r.orderId||'').trim();
        if(id&&(!TECH_RE.test(id)||r._integrationE2E===true)&&!knownDeleted.has(id)&&!pushDeletes.has(id))pushRows.set(id,r);
      }
      scheduleBridgeFlush();
    }
    function enqueueBridgeDeletes(items){
      for(const x of items||[]){
        const id=String(x&&x.orderId||'').trim();
        if(id){const d={orderId:id,deletedAt:String(x.deletedAt||new Date().toISOString()),source:'crm'};pushRows.delete(id);pushDeletes.set(id,d);knownDeleted.add(id)}
      }
      scheduleBridgeFlush();
    }
    function scheduleBridgeFlush(delay=1200){
      clearTimeout(pushTimer);
      pushTimer=setTimeout(flushBridge,Math.max(250,delay));
    }
    async function resolveDeleteTombstones(ids){
      ids=[...new Set((ids||[]).map(String).filter(Boolean))];
      if(!ids.length||cloud.profile?.role!=='owner')return;
      const dead=new Set(ids);
      try{
        await fs.runTransaction(db,async tx=>{
          const d=await tx.get(googleRef),x=d.exists()?d.data():{};
          const pending=(Array.isArray(x.deletedOrders)?x.deletedOrders:[]).filter(t=>!dead.has(String(t&&t.orderId||'')));
          tx.set(googleRef,{deletedOrders:pending,updatedAt:fs.serverTimestamp()},{merge:true});
        });
      }catch(e){console.warn('resolve Google delete tombstones deferred',e)}
    }
    async function persistDeltaState(extra={}){
      if(cloud.profile?.role!=='owner')return;
      try{await fs.setDoc(googleRef,{syncBaseline:baselineMap,syncBaselineVersion:1,deltaSync:{patch:PATCH,pendingRows:pushRows.size,pendingDeletes:pushDeletes.size,retryCount:bridgeRetryAttempt,deadLetter:!!diag.deltaDeadLetter,lastError:diag.lastBridgeError||'',lastSuccessAt:diag.lastBridgeSuccessAt||'',updatedAt:new Date().toISOString(),...extra}},{merge:true})}catch(e){console.warn('delta state persist deferred',e)}
    }
    async function recoverDirtyFromBaseline(rows){
      if(cloud.profile?.role!=='owner')return 0;
      const g=(googleCfg&&Object.keys(googleCfg).length)?googleCfg:await refreshGoogleCfg();
      if(Number(g.syncBaselineVersion||0)<1||!Object.keys(baselineMap).length){diag.recoverySkipped++;return 0}
      let n=0;
      for(const r of rows||[]){
        const id=String(r&&r.orderId||'').trim();
        if(!id||TECH_RE.test(id)||knownDeleted.has(id))continue;
        if(baselineMap[id]!==rowHash(r)){pushRows.set(id,{...r});n++}
      }
      diag.recoveredDirty+=n;
      if(n)scheduleBridgeFlush(600);
      return n;
    }
    async function flushBridge(){
      if(bridgeFlushing||cloud.profile?.role!=='owner')return;
      if(!pushRows.size&&!pushDeletes.size)return;
      bridgeFlushing=true;
      try{
        const g=await refreshGoogleCfg();
        const until=Number(g.syncLockUntilMs)||0;
        if(g.syncLockToken&&until>Date.now()){diag.lockDeferrals++;scheduleBridgeFlush(Math.min(30000,Math.max(1000,until-Date.now()+800)));return}
        const sid=sheetId(g.sheetUrl);
        if(!g.bridgeUrl||!g.secret||!sid)throw new Error('Google Bridge не настроен');
        const dels=[...pushDeletes.entries()].slice(0,10),rows=[...pushRows.entries()].slice(0,4);
        let failed=0,okRows=0,okDeletes=0,lastErr='',resolvedDeleteIds=[];
        for(const [id,item] of dels){
          try{
            await bridgePost({action:'delete',secret:g.secret,spreadsheetId:sid,orderId:id});
            if(pushDeletes.get(id)===item)pushDeletes.delete(id);
            delete baselineMap[id];resolvedDeleteIds.push(id);okDeletes++;diag.bridgeDeletes++;
          }catch(e){failed++;lastErr=String(e&&e.message||e);diag.bridgeErrors++}
        }
        if(resolvedDeleteIds.length)await resolveDeleteTombstones(resolvedDeleteIds);
        for(const [id,item] of rows){
          if(knownDeleted.has(id)||pushDeletes.has(id)){if(pushRows.get(id)===item)pushRows.delete(id);continue}
          try{
            await bridgePost({action:'upsert',secret:g.secret,spreadsheetId:sid,order:item});
            if(pushRows.get(id)===item)pushRows.delete(id);
            baselineMap[id]=rowHash(item);okRows++;diag.bridgePushes++;
          }catch(e){failed++;lastErr=String(e&&e.message||e);diag.bridgeErrors++}
        }
        if(failed){
          bridgeRetryAttempt++;
          diag.lastBridgeError=lastErr.slice(0,500);
          diag.deltaRetryCount=bridgeRetryAttempt;
          diag.deltaDeadLetter=bridgeRetryAttempt>=5;
          await persistDeltaState({lastFailureAt:new Date().toISOString()});
          if(bridgeRetryAttempt<5)scheduleBridgeFlush(Math.min(60000,2000*Math.pow(2,bridgeRetryAttempt-1)));
        }else{
          bridgeRetryAttempt=0;diag.deltaRetryCount=0;diag.deltaDeadLetter=false;diag.lastBridgeError='';diag.lastBridgeSuccessAt=new Date().toISOString();
          await persistDeltaState({lastSuccessAt:diag.lastBridgeSuccessAt,lastFailureAt:''});
          if(pushRows.size||pushDeletes.size)scheduleBridgeFlush(900);
        }
        diag.lastFlush={at:new Date().toISOString(),okRows,okDeletes,failed,pendingRows:pushRows.size,pendingDeletes:pushDeletes.size};
      }catch(e){
        bridgeRetryAttempt++;diag.bridgeErrors++;diag.lastBridgeError=String(e&&e.message||e).slice(0,500);diag.deltaRetryCount=bridgeRetryAttempt;diag.deltaDeadLetter=bridgeRetryAttempt>=5;
        await persistDeltaState({lastFailureAt:new Date().toISOString()});
        if(bridgeRetryAttempt<5)scheduleBridgeFlush(Math.min(60000,2000*Math.pow(2,bridgeRetryAttempt-1)));
        console.warn('incremental Google flush deferred',e);
      }finally{bridgeFlushing=false}
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
      if(!originalRequest||!cloud.connected||cloud.profile?.role!=='owner')return null;
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
          const before=new Set(knownDeleted);
          googleCfg=d.exists()?d.data():{};baselineMap=safeBaseline(googleCfg.syncBaseline);
          const pendingDeletes=(Array.isArray(googleCfg.deletedOrders)?googleCfg.deletedOrders:[]).map(x=>({orderId:String(x&&x.orderId||''),deletedAt:String(x&&x.deletedAt||''),source:String(x&&x.source||'recovery')})).filter(x=>x.orderId);
          const cacheChanged=applyTombstones(cacheMap,googleCfg);
          if(role==='owner'){
            const need=tombstoneSnapshotReady?pendingDeletes.filter(x=>!before.has(x.orderId)):pendingDeletes;
            if(need.length)enqueueBridgeDeletes(need);
          }
          tombstoneSnapshotReady=true;
          if(cacheChanged){
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
            if(TECH_RE.test(id)){
              cacheMap.delete(id);cloud.versions.delete(id);
              if(role==='owner'&&row._integrationE2E===true&&ch.type!=='removed'&&!knownDeleted.has(id))enqueueBridgeRows([row]);
              continue;
            }
            if(knownDeleted.has(id)){cacheMap.delete(id);cloud.versions.delete(id);continue}
            if(ch.type==='removed'){cacheMap.delete(id);cloud.versions.delete(id)}
            else{cacheMap.set(id,row);cloud.versions.set(id,String(row._updatedAt||''));if(!initial)changedRows.push(row)}
          }
          cloud.ownerRows=[...cacheMap.values()];cloud.ownerSeenReady=true;
          onRows(cloud.ownerRows);
          if(!initial&&role==='owner'&&changedRows.length)enqueueBridgeRows(changedRows);
          if(initial&&role==='owner')setTimeout(()=>recoverDirtyFromBaseline([...cacheMap.values()]).catch(e=>console.warn('baseline recovery',e)),700);
          initial=false;
        },err=>{
          console.warn('quota-safe delta realtime',err);
          if(cacheMap.size){window.MasterAICloudStatus&&window.MasterAICloudStatus('warn','Работа из сохранённого снимка · облачная квота временно недоступна');onRows([...cacheMap.values()])}
          else window.MasterAICloudStatus&&window.MasterAICloudStatus('error','Ошибка real-time: '+String(err&&err.message||err));
        });

        if(role==='owner'){
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
        if(String(role||'')==='owner'&&Array.isArray(deleted)&&deleted.length){
          const ds=deleted.map(x=>({orderId:String(x&&x.orderId||''),deletedAt:String(x&&x.deletedAt||new Date().toISOString()),source:'crm'})).filter(x=>x.orderId);
          rememberDeletes(ds);enqueueBridgeDeletes(ds);
        }
        return ret;
      };
    }

    if(originalHealth){
      cloud.integrationHealth=async function(){
        const h=await originalHealth();
        h.version='18.17.13 Spark';
        h.syncState={...(h.syncState||{}),quotaSafeReads:true,deltaRealtime:diag.mode==='delta',deltaCursor:diag.lastCursor,cacheRows:diag.cacheRows,deltaReads:diag.deltaReads,bridgeMode:'direct_upsert_delete',bridgeDeltaPushes:diag.bridgePushes,bridgeDeltaDeletes:diag.bridgeDeletes,bridgeDeltaErrors:diag.bridgeErrors,bridgePendingRows:pushRows.size,bridgePendingDeletes:pushDeletes.size,deltaRetryCount:diag.deltaRetryCount,deltaDeadLetter:diag.deltaDeadLetter,recoveredDirty:diag.recoveredDirty,lockDeferrals:diag.lockDeferrals,fullReconcileMinutes:15,googleCoordinator:['owner'],pendingDurableDeletes:(Array.isArray(googleCfg.deletedOrders)?googleCfg.deletedOrders.length:0),integrationE2EBridge:true,patch:PATCH};
        return h;
      };
    }

    cloud.__quotaSafePatch=PATCH;
    window.MASTER_AI_QUOTA_SAFE={version:PATCH,diag,forcePull:()=>maybeFullPull('quota_safe_manual',true),flush:flushBridge};
    window.MASTER_AI_BUILD='18.17.13-CANDIDATE';
    console.info('MASTER AI quota-safe patch installed',PATCH);
  }

  Object.defineProperty(window,'MasterAICloud',{
    configurable:true,
    enumerable:true,
    get(){return cloudValue},
    set(v){cloudValue=v;armCloudObject(v)}
  });
})();
