/* MASTER AI 18.17.17 — Spark quota-safe realtime / Bridge Protocol v2 + technical tombstone cleanup.
   Loaded synchronously from cloud-config.js before the embedded cloud adapter.
   No production endpoints, no billing, no secrets. */
(function(){
  'use strict';
  const PATCH='18.17.17-tech-tombstone';
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
  function bridgeEndpoint(g){return String(g&&g.bridgeUrlV2||g&&g.bridgeUrl||'').trim()}
  function bridgeReady(g){return !!(g&&bridgeEndpoint(g)&&g.secret&&sheetId(g.sheetUrl))}

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
        let x=d.exists()?d.data():{};
        if(cloud.profile?.role==='owner'){
          const legacy=String(x.bridgeUrl||''),v2=String(x.bridgeUrlV2||''),activate=String(window.MASTER_AI_BUILD||'').includes('18.17.17-CURRENT');
          if(!v2&&legacy){
            const patch={bridgeUrlV2:legacy,bridgeProtocol:2,legacyBridgeDisabled:activate,bridgeProtocolUpdatedAt:new Date().toISOString()};
            if(activate)patch.bridgeUrl='';
            await fs.setDoc(googleRef,patch,{merge:true});
            x={...x,...patch};
          }else if(v2&&legacy&&activate){
            await fs.setDoc(googleRef,{bridgeUrl:'',bridgeProtocol:2,legacyBridgeDisabled:true,bridgeProtocolUpdatedAt:new Date().toISOString()},{merge:true});
            x={...x,bridgeUrl:'',bridgeProtocol:2,legacyBridgeDisabled:true};
          }
        }
        googleCfg=x;
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
      const g=(googleCfg&&bridgeEndpoint(googleCfg))?googleCfg:await refreshGoogleCfg();
      const endpoint=bridgeEndpoint(g);
      if(!endpoint||!g.secret)throw new Error('Google Bridge v2 не настроен');
      const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),45000);
      try{
        const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),signal:ac.signal});
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
      if(!ids.length)return 0;
      const dead=new Set(ids);
      let lastErr=null;
      for(let attempt=1;attempt<=3;attempt++){
        try{
          const d=await fs.getDoc(googleRef),x=d.exists()?d.data():{},current=Array.isArray(x.deletedOrders)?x.deletedOrders:[];
          const pending=current.filter(t=>!dead.has(String(t&&t.orderId||'')));
          if(pending.length!==current.length)await fs.updateDoc(googleRef,{deletedOrders:pending,updatedAt:fs.serverTimestamp()});
          const v=await fs.getDoc(googleRef),left=(v.exists()&&Array.isArray(v.data().deletedOrders)?v.data().deletedOrders:[]).filter(t=>dead.has(String(t&&t.orderId||''))).length;
          if(!left)return current.length-pending.length;
          lastErr=new Error('tombstone verify left='+left);
        }catch(e){lastErr=e}
        await sleep(150*attempt);
      }
      console.warn('resolve Google delete tombstones deferred',lastErr);
      throw lastErr||new Error('tombstone resolve failed');
    }
    async function reapTechnicalTombstones(){
      if(cloud.profile?.role!=='owner')return 0;
      const g=(googleCfg&&Object.keys(googleCfg).length)?googleCfg:await refreshGoogleCfg();
      const sid=sheetId(g.sheetUrl);
      if(!bridgeReady(g)||!sid)return 0;
      const tech=(Array.isArray(g.deletedOrders)?g.deletedOrders:[]).map(x=>({orderId:String(x&&x.orderId||'').trim(),deletedAt:String(x&&x.deletedAt||'')})).filter(x=>x.orderId&&TECH_RE.test(x.orderId)).slice(0,20);
      if(!tech.length)return 0;
      const resolved=[];
      for(const t of tech){
        try{
          await bridgePost({action:'delete',secret:g.secret,spreadsheetId:sid,orderId:t.orderId});
          resolved.push(t.orderId);diag.bridgeDeletes++;
        }catch(e){
          diag.bridgeErrors++;diag.lastBridgeError=String(e&&e.message||e).slice(0,500);
          console.warn('technical tombstone cleanup deferred',t.orderId,e);
        }
      }
      if(resolved.length){
        await resolveDeleteTombstones(resolved);
        const dead=new Set(resolved);
        googleCfg={...g,deletedOrders:(Array.isArray(g.deletedOrders)?g.deletedOrders:[]).filter(x=>!dead.has(String(x&&x.orderId||'')))};
        diag.lastBridgeSuccessAt=new Date().toISOString();
      }
      return resolved.length;
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
        if(!bridgeReady(g))throw new Error('Google Bridge v2 не настроен');
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
    async function manualReconcileV2(opts={}){
      if(!cloud.connected||cloud.profile?.role!=='owner')throw new Error('Ручная сверка доступна только владельцу');
      const g=await refreshGoogleCfg(),sid=sheetId(g.sheetUrl);
      if(!bridgeReady(g))throw new Error('Google Bridge v2 не настроен');
      let rows=Array.isArray(cloud.ownerRows)&&cloud.ownerRows.length?cloud.ownerRows.map(r=>({...r})):null;
      if(!rows){const snap=await fs.getDocs(ordersCol);rows=snap.docs.map(d=>({orderId:d.id,...d.data()}));diag.deltaReads+=snap.size}
      const dead=new Set([...(Array.isArray(g.deletedOrders)?g.deletedOrders:[]),...(Array.isArray(g.deletedHistory)?g.deletedHistory:[])].map(x=>String(x&&x.orderId||'')).filter(Boolean));
      const canonical=new Map();
      for(const r0 of rows||[]){const r={...(r0||{})},id=String(r.orderId||'').trim();if(id&&!TECH_RE.test(id)&&!dead.has(id))canonical.set(id,r)}
      const orders=[...canonical.values()];
      if(opts.dryRun){
        const p=await bridgePost({action:'ping',secret:g.secret,spreadsheetId:sid});
        return{ok:true,dryRun:true,canonical:orders.length,bridgeProtocol:2,ping:!!(p&&p.ok)};
      }
      const token='v2-'+Date.now()+'-'+Math.random().toString(36).slice(2),started=new Date().toISOString();
      await fs.runTransaction(db,async tx=>{
        const d=await tx.get(googleRef),x=d.exists()?d.data():{},until=Number(x.syncLockUntilMs)||0;
        if(x.syncLockToken&&until>Date.now()){const e=new Error('Google sync busy');e.code='SYNC_BUSY';throw e}
        tx.set(googleRef,{syncLockToken:token,syncLockUntilMs:Date.now()+90000,syncLockOwner:'18.17.16-v2',syncLockAt:started},{merge:true});
      });
      try{
        const tombstones=(Array.isArray(g.deletedOrders)?g.deletedOrders:[]).filter(x=>String(x&&x.orderId||'').trim());
        if(tombstones.length>50)throw new Error('Safety stop: pending deletes='+tombstones.length);
        for(const t of tombstones)await bridgePost({action:'delete',secret:g.secret,spreadsheetId:sid,orderId:String(t.orderId||'')});
        const j=await bridgePost({action:'merge',secret:g.secret,spreadsheetId:sid,orders,deleted:[],members:[],audit:[],source:{app:'MASTER AI',build:window.MASTER_AI_BUILD||'',reason:String(opts.reason||'manual_v2'),bridgeProtocol:2,canonical:'firestore'}});
        const incoming=Array.isArray(j&&j.orders)?j.orders:[],seen=new Map(),duplicates=[],missing=[];
        for(const row of incoming){const id=String(row&&row.orderId||'').trim();if(!id){missing.push(row);continue}if(seen.has(id))duplicates.push(id);else seen.set(id,row)}
        if(missing.length)throw new Error('Bridge вернул строки без ID: '+missing.length);
        if(duplicates.length)throw new Error('Bridge вернул дубли ID: '+[...new Set(duplicates)].slice(0,10).join(', '));
        const extras=[...seen.keys()].filter(id=>!canonical.has(id)),mismatches=[];
        for(const [id,row] of canonical){const got=seen.get(id);if(!got||rowHash(got)!==rowHash(row))mismatches.push(id)}
        if(extras.length>50||mismatches.length>50)throw new Error('Safety stop: extras='+extras.length+', mismatches='+mismatches.length);
        for(const id of extras)await bridgePost({action:'delete',secret:g.secret,spreadsheetId:sid,orderId:id});
        for(const id of mismatches)await bridgePost({action:'upsert',secret:g.secret,spreadsheetId:sid,order:canonical.get(id)});
        baselineMap={};for(const [id,row] of canonical)baselineMap[id]=rowHash(row);
        const counts={firestoreSent:orders.length,bridgeReturned:incoming.length,canonical:orders.length,duplicates:0,missingIds:0,extrasRemoved:extras.length,canonicalRepairs:mismatches.length,deletionsSent:tombstones.length,deletionsResolved:tombstones.length,deletionsPending:0,dryRun:false,bridgeProtocol:2};
        const activate=String(window.MASTER_AI_BUILD||'').includes('18.17.17-CURRENT'),endpoint=bridgeEndpoint(g);
        await fs.setDoc(googleRef,{deletedOrders:[],syncBaseline:baselineMap,syncBaselineVersion:1,lastSuccessAt:new Date().toISOString(),lastError:'',retryCount:0,deadLetter:false,lastCounts:counts,lastReason:String(opts.reason||'manual_v2'),lastStartedAt:started,bridgeProtocol:2,legacyBridgeDisabled:activate,bridgeUrl:activate?'':endpoint,bridgeUrlV2:endpoint},{merge:true});
        googleCfg={...g,deletedOrders:[],syncBaseline:baselineMap,syncBaselineVersion:1,bridgeProtocol:2,legacyBridgeDisabled:activate,bridgeUrl:activate?'':endpoint,bridgeUrlV2:endpoint};
        return{ok:true,count:orders.length,...counts};
      }catch(e){
        try{await fs.setDoc(googleRef,{lastFailureAt:new Date().toISOString(),lastError:String(e&&e.message||e).slice(0,1200)},{merge:true})}catch(_){}
        throw e;
      }finally{
        try{await fs.runTransaction(db,async tx=>{const d=await tx.get(googleRef),x=d.exists()?d.data():{};if(String(x.syncLockToken||'')===token)tx.set(googleRef,{syncLockToken:'',syncLockUntilMs:0,syncLockOwner:'',syncLockReleasedAt:new Date().toISOString()},{merge:true})})}catch(e){console.warn('manual v2 lock release',e)}
      }
    }
    async function maybeFullPull(reason,force){
      if(!cloud.connected||cloud.profile?.role!=='owner')return null;
      if(!force){diag.fullPullSkips++;return null}
      diag.fullPulls++;
      return manualReconcileV2({reason:reason||'quota_safe_manual_reconcile'});
    }

    cloud.subscribe=function(profile,onRows){
      const role=String(profile&&profile.role||'');
      if(!['owner','dispatcher_logistic','logistic'].includes(role)||!originalSubscribe)return originalSubscribe?originalSubscribe(profile,onRows):null;
      try{cloud.unsub&&cloud.unsub()}catch(e){}
      try{googleUnsub&&googleUnsub()}catch(e){}
      if(cloud.googlePeriodicTimer){clearInterval(cloud.googlePeriodicTimer);cloud.googlePeriodicTimer=null}
      return (async()=>{
        if(role==='owner'){await refreshGoogleCfg();await reapTechnicalTombstones()}
        const cached=await readCache();
        let cachedRows=validRows(cached&&cached.orders,cached&&cached.deletedOrders),bootstrapped=false;
        if(cachedRows.length<500){
          diag.mode='bootstrap_full_safe';diag.cacheRows=cachedRows.length;
          try{
            const snap=await fs.getDocs(ordersCol);
            cachedRows=validRows(snap.docs.map(d=>({...d.data(),_cloudDocId:d.id})),cached&&cached.deletedOrders);
            diag.deltaReads+=snap.size;bootstrapped=true;
          }catch(e){
            if(!cachedRows.length)throw e;
            console.warn('quota-safe bootstrap snapshot unavailable; using local cache',e);
          }
        }
        const cacheMap=new Map(cachedRows.map(r=>[String(r.orderId),{...r}]));
        const cursor=isoCursor(cachedRows)||new Date(Date.now()-300000).toISOString();
        diag.mode=bootstrapped?'bootstrap_delta':'delta';diag.cacheRows=cacheMap.size;diag.lastCursor=cursor;
        cloud.ownerRows=[...cacheMap.values()];cloud.ownerSeenReady=true;
        cloud.versions.clear();for(const r of cacheMap.values())cloud.versions.set(String(r.orderId),String(r._updatedAt||''));
        onRows([...cacheMap.values()]);

        googleUnsub=fs.onSnapshot(googleRef,d=>{
          const before=new Set(knownDeleted);
          googleCfg=d.exists()?d.data():{};baselineMap=safeBaseline(googleCfg.syncBaseline);
          if(role==='owner'&&String(window.MASTER_AI_BUILD||'').includes('18.17.17-CURRENT')&&googleCfg.bridgeUrlV2&&googleCfg.bridgeUrl){
            fs.setDoc(googleRef,{bridgeUrl:'',bridgeProtocol:2,legacyBridgeDisabled:true,bridgeProtocolUpdatedAt:new Date().toISOString()},{merge:true}).catch(e=>console.warn('Bridge v2 legacy endpoint kill-switch deferred',e));
          }
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

        /* Full Google reconciliation is manual-only in 18.17.17.
           Ordinary operation is direct idempotent upsert/delete; no full merge on open/focus/timer. */
        return cloud.unsub;
      })();
    };

    if(originalQueue){
      cloud.queueSync=function(orders,deleted,settings,role){
        const safeDeleted=Array.isArray(deleted)?deleted.filter(x=>!TECH_RE.test(String(x&&x.orderId||''))):deleted;
        const ret=originalQueue(orders,safeDeleted,settings,role);
        if(String(role||'')==='owner'&&Array.isArray(deleted)&&deleted.length){
          const ds=deleted.map(x=>({orderId:String(x&&x.orderId||''),deletedAt:String(x&&x.deletedAt||new Date().toISOString()),source:'crm'})).filter(x=>x.orderId);
          rememberDeletes(ds);enqueueBridgeDeletes(ds);
        }
        return ret;
      };
    }

    cloud.getGoogle=async function(){
      const g=await refreshGoogleCfg();
      return{...g,bridgeUrl:bridgeEndpoint(g),bridgeProtocol:2,legacyBridgeDisabled:true};
    };
    cloud.saveGoogle=async function(x={}){
      if(cloud.profile?.role!=='owner')throw new Error('Только владелец');
      const cur=await refreshGoogleCfg(),endpoint=String(x.bridgeUrlV2||x.bridgeUrl||bridgeEndpoint(cur)||'').trim(),activate=String(window.MASTER_AI_BUILD||'').includes('18.17.17-CURRENT');
      if(!endpoint)throw new Error('URL Google Bridge не задан');
      await fs.setDoc(googleRef,{sheetUrl:String(x.sheetUrl||cur.sheetUrl||''),bridgeUrlV2:endpoint,bridgeUrl:activate?'':endpoint,secret:String(x.secret||cur.secret||''),bridgeProtocol:2,legacyBridgeDisabled:activate,bridgeProtocolUpdatedAt:new Date().toISOString(),updatedAt:fs.serverTimestamp()},{merge:true});
      googleCfg={...cur,sheetUrl:String(x.sheetUrl||cur.sheetUrl||''),bridgeUrlV2:endpoint,bridgeUrl:activate?'':endpoint,secret:String(x.secret||cur.secret||''),bridgeProtocol:2,legacyBridgeDisabled:activate};
      return{ok:true,bridgeProtocol:2,legacyBridgeDisabled:activate};
    };
    cloud.testGoogle=async function(){
      const g=await refreshGoogleCfg(),sid=sheetId(g.sheetUrl);
      if(!bridgeReady(g))throw new Error('Google Bridge v2 не настроен');
      return bridgePost({action:'ping',secret:g.secret,spreadsheetId:sid});
    };
    cloud.syncGoogleNow=manualReconcileV2;
    cloud.integrationTestDelete=async function(id){
      if(cloud.profile?.role!=='owner')throw new Error('Только владелец');
      id=String(id||'').trim();
      if(!/^INTEG-E2E-[A-Z0-9-]{6,80}$/.test(id))throw new Error('Некорректный test ID');
      const g=await refreshGoogleCfg(),sid=sheetId(g.sheetUrl);
      if(bridgeReady(g)&&sid)await bridgePost({action:'delete',secret:g.secret,spreadsheetId:sid,orderId:id});
      knownDeleted.add(id);pushRows.delete(id);pushDeletes.delete(id);
      await Promise.all([
        fs.deleteDoc(fs.doc(db,'workspaces',ws,'orders',id)),
        fs.deleteDoc(fs.doc(db,'workspaces',ws,'dispatcherOrders',id)),
        fs.deleteDoc(fs.doc(db,'workspaces',ws,'masterAssignments',id)),
        fs.deleteDoc(fs.doc(db,'workspaces',ws,'phoneAccess',id))
      ]);
      await resolveDeleteTombstones([id]);
      return{ok:true,id,bridgeProtocol:2,tombstoneResolved:true};
    };

    /* Hard gate legacy automatic full reconciliation. Explicit manual reconciliation
       remains available through MASTER_AI_QUOTA_SAFE.forcePull() / syncGoogleNow(). */
    cloud.requestGoogleSync=function(reason='auto_blocked'){
      diag.fullPullSkips++;
      return Promise.resolve({ok:true,skipped:true,reason:String(reason||'auto_blocked'),mode:'manual_only'});
    };

    if(originalHealth){
      cloud.integrationHealth=async function(){
        const h=await originalHealth();
        h.version='18.17.17 Spark';
        const vg=await refreshGoogleCfg();
        try{
          const sid=sheetId(vg.sheetUrl);
          if(bridgeReady(vg)){
            const p=await bridgePost({action:'ping',secret:vg.secret,spreadsheetId:sid});
            h.google={...(h.google||{}),...p,configured:true,ok:true,message:p&&p.message||'Связь работает',bridgeProtocol:2};
          }else h.google={...(h.google||{}),configured:false,ok:false,message:'Google Bridge v2 не настроен',bridgeProtocol:2};
        }catch(e){h.google={...(h.google||{}),configured:true,ok:false,message:String(e&&e.message||e),bridgeProtocol:2}}
        h.syncState={...(h.syncState||{}),quotaSafeReads:true,deltaRealtime:['delta','bootstrap_delta'].includes(diag.mode),deltaCursor:diag.lastCursor,cacheRows:diag.cacheRows,deltaReads:diag.deltaReads,bridgeMode:'direct_upsert_delete',bridgeDeltaPushes:diag.bridgePushes,bridgeDeltaDeletes:diag.bridgeDeletes,bridgeDeltaErrors:diag.bridgeErrors,bridgePendingRows:pushRows.size,bridgePendingDeletes:pushDeletes.size,deltaRetryCount:diag.deltaRetryCount,deltaDeadLetter:diag.deltaDeadLetter,recoveredDirty:diag.recoveredDirty,lockDeferrals:diag.lockDeferrals,fullReconcileMode:'manual_only',legacyAutoFullSyncBlocked:true,autoCoordinator:['owner'],googleCoordinator:['owner'],autoFlushOnOpen:false,autoFlushDirect:true,eventDriven:true,queueCoalescing:true,focusPull:false,retryLimit:5,busyRetryLimit:0,pendingDurableDeletes:(Array.isArray(googleCfg.deletedOrders)?googleCfg.deletedOrders.length:0),integrationE2EBridge:true,technicalTombstoneCleanup:true,bridgeProtocol:2,legacyBridgeEndpointDisabled:!!googleCfg.bridgeUrlV2&&!googleCfg.bridgeUrl,manualReconcileCanonical:'firestore_to_google',patch:PATCH};
        return h;
      };
    }

    cloud.__quotaSafePatch=PATCH;
    window.MASTER_AI_QUOTA_SAFE={version:PATCH,diag,forcePull:()=>manualReconcileV2({reason:'quota_safe_manual_v2'}),flush:flushBridge,reconcile:manualReconcileV2};
    window.MASTER_AI_BUILD='18.17.17-CANDIDATE';
    console.info('MASTER AI quota-safe patch installed',PATCH);
  }

  Object.defineProperty(window,'MasterAICloud',{
    configurable:true,
    enumerable:true,
    get(){return cloudValue},
    set(v){cloudValue=v;armCloudObject(v)}
  });
})();
