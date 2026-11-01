/* CRM_UNIT:DB-07afe27772bb */
const DB='master_ai_orders_v4', STORE='kv', KEY='app';/* CRM_END:DB-07afe27772bb */
/* CRM_UNIT:idbOpen-74cf566368f9 */
function idbOpen(){return new Promise((resolve,reject)=>{const q=indexedDB.open(DB,1);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains(STORE))q.result.createObjectStore(STORE)};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})}/* CRM_END:idbOpen-74cf566368f9 */
/* CRM_UNIT:legacyIdbRead-28fa1f1c4aa5 */
async function legacyIdbRead(){try{const db=await idbOpen();return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),q=tx.objectStore(STORE).get(KEY);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error)})}catch{return null}}/* CRM_END:legacyIdbRead-28fa1f1c4aa5 */
/* CRM_UNIT:BETA_STATE_API-5a95484d63eb */
const BETA_STATE_API='/api/state',BETA_RESET_API='/api/reset';/* CRM_END:BETA_STATE_API-5a95484d63eb */
/* CRM_UNIT:betaLastAppliedSavedAt-cc3a494a1c3d */
let betaLastAppliedSavedAt='',betaBroadcast=null,betaSyncBusy=false,betaLiveTimer=null,betaReminderTimer=null,betaCloudSnapshotReady=false;/* CRM_END:betaLastAppliedSavedAt-cc3a494a1c3d */
/* CRM_UNIT:betaApplyTombstones-f274cd0fe608 */
function betaApplyTombstones(payload){const p={...(payload||{})},del=Array.isArray(p.deletedOrders)?p.deletedOrders:[],dead=new Set(del.map(x=>clean(x?.orderId)).filter(Boolean));p.orders=(Array.isArray(p.orders)?p.orders:[]).filter(x=>!dead.has(clean(x?.orderId)));p.settings=betaSafeSettings(p.settings);return p}/* CRM_END:betaApplyTombstones-f274cd0fe608 */
/* CRM_UNIT:betaServerRead-05b53348b00f */
async function betaServerRead(){const res=await fetch(BETA_STATE_API,{cache:'no-store',headers:{'Accept':'application/json'}});if(!res.ok)throw new Error('BETA state HTTP '+res.status);return betaApplyTombstones(await res.json())}/* CRM_END:betaServerRead-05b53348b00f */
/* CRM_UNIT:betaServerWrite-1a56935d0a08 */
async function betaServerWrite(payload){const p=betaApplyTombstones(payload);const res=await fetch(BETA_STATE_API,{method:'PUT',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(p)});if(!res.ok){let msg='HTTP '+res.status;try{const e=await res.json();if(e?.error)msg=e.error}catch{}throw new Error('BETA save: '+msg)}return await res.json()}/* CRM_END:betaServerWrite-1a56935d0a08 */
/* CRM_UNIT:dbRead-8746923ed5d0 */
async function dbRead(){if(SECURE_CLOUD_REQUIRED)return null;if(window.MASTER_AI_BETA&&!window.MASTER_AI_BETA_ONLINE)return await betaServerRead();try{const db=await idbOpen();return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),q=tx.objectStore(STORE).get(KEY);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error)})}catch{return null}}/* CRM_END:dbRead-8746923ed5d0 */
/* CRM_UNIT:betaPullServerState-65e7de049695 */
async function betaPullServerState(){if(!window.MASTER_AI_BETA||window.MASTER_AI_BETA_ONLINE||betaSyncBusy)return;betaSyncBusy=true;try{const d=await betaServerRead();if(d.savedAt&&d.savedAt!==betaLastAppliedSavedAt)betaApplyIncoming(d)}catch(e){console.warn('BETA live sync',e)}finally{betaSyncBusy=false}}/* CRM_END:betaPullServerState-65e7de049695 */
/* CRM_UNIT:betaStartLiveSync-34e7675e0732 */
function betaStartLiveSync(){if(!window.MASTER_AI_BETA||window.MASTER_AI_BETA_ONLINE)return;betaLastAppliedSavedAt=betaLastAppliedSavedAt||new Date().toISOString();try{betaBroadcast=new BroadcastChannel('MASTER_AI_BETA_STATE_V1');betaBroadcast.onmessage=e=>{if(e?.data?.type==='state-saved')betaPullServerState()}}catch{}if(betaLiveTimer)clearInterval(betaLiveTimer);betaLiveTimer=setInterval(betaPullServerState,3000);if(betaReminderTimer)clearInterval(betaReminderTimer);betaReminderTimer=setInterval(betaUpcomingReminders,60000);betaUpdateNotificationButtons();setTimeout(betaUpcomingReminders,1500)}/* CRM_END:betaStartLiveSync-34e7675e0732 */
/* CRM_UNIT:syncStatusPalette-92bc6790daa0 */
function syncStatusPalette(){$$('[data-status]').forEach(b=>b.classList.toggle('active',b.dataset.status===$('#f_status').value))}/* CRM_END:syncStatusPalette-92bc6790daa0 */
/* CRM_UNIT:cloudMode-e9383c487759 */
function cloudMode(){return !!window.MasterAICloud?.enabled}/* CRM_END:cloudMode-e9383c487759 */
/* CRM_UNIT:syncSelectionUI-38d9e7bd8e92 */
function syncSelectionUI(rows=currentOrderRows()){state.visibleOrderIds=rows.map(r=>r._id);const n=state.selected.size,bar=$('#bulkBar');if(bar)bar.hidden=n===0;if($('#bulkCount'))$('#bulkCount').textContent=`Выбрано: ${n}`;const shown=currentOrderPage(rows),vis=shown.length,selVis=shown.filter(r=>state.selected.has(r._id)).length;if($('#selectVisible')){$('#selectVisible').checked=vis>0&&selVis===vis;$('#selectVisible').indeterminate=selVis>0&&selVis<vis}if($('#bulkModalSub'))$('#bulkModalSub').textContent=`Выбрано ${n} заказов`;if($('#bulkPreview'))$('#bulkPreview').innerHTML=n?(can('money')?`Будет обработано: <b>${n}</b>. Общая сумма выбранных: <b>${money(sum(state.orders.filter(r=>state.selected.has(r._id)),r=>num(r.total)))}</b>; касса: <b>${money(sum(state.orders.filter(r=>state.selected.has(r._id)),r=>num(r.companyShare)))}</b>.`:`Будет обработано заказов: <b>${n}</b>.`):'Заказы не выбраны.'}/* CRM_END:syncSelectionUI-38d9e7bd8e92 */
/* CRM_UNIT:bindBarsToFilter-74c77861f5a8 */
function bindBarsToFilter(containerId,selectId,kind){const c=$('#'+containerId);if(!c)return;$$('#'+containerId+' .barrow').forEach(row=>{row.classList.add('clickable');row.tabIndex=0;const key=row.firstElementChild?.textContent||'';const go=()=>setCanonicalFilter(selectId,key,(kind==='master'?'Мастер: ':kind==='city'?'Город: ':kind==='direction'?'Направление: ':'Диспетчер-логист: ')+key);row.onclick=go;row.onkeydown=e=>{if(e.key==='Enter')go()}})}/* CRM_END:bindBarsToFilter-74c77861f5a8 */
/* CRM_UNIT:syncDispatcherShiftFilter-22d5d4dd1ed2 */
function syncDispatcherShiftFilter(id){const shift=$('#dashboardShift'),disp=$('#dispFilter');if(!shift||!disp)return;if(id==='dashboardShift'){const key=payrollShiftKey({shift:shift.value});disp.value=key?Array.from(disp.options).find(o=>payrollShiftKey({approvedForName:o.value})===key)?.value||'':''}else if(id==='dispFilter')shift.value=payrollShiftKey({approvedForName:disp.value})}/* CRM_END:syncDispatcherShiftFilter-22d5d4dd1ed2 */
