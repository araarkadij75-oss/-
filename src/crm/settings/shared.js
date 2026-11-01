/* CRM_UNIT:betaSafeSettings-799ed7603a7b */
function betaSafeSettings(v){const x={...(v||{})};x.googleBridgeUrl='';x.googleSecret='';x.googleAutoSync=false;x.googleSheetUrl='';return x}/* CRM_END:betaSafeSettings-799ed7603a7b */
/* CRM_UNIT:backupPayload-82ac3d98450a */
function backupPayload(){return {app:'EliteService Orders PRO',version:18,exportedAt:new Date().toISOString(),schema:APP_HEADERS,orders:state.orders,expenses:state.expenses,deletedOrders:state.deletedOrders,settings:state.settings,audit:state.audit,shiftReports:state.shiftReports||[],weeklyShiftReports:state.weeklyShiftReports||[],masterShifts:state.masterShifts||[]}}/* CRM_END:backupPayload-82ac3d98450a */
/* CRM_UNIT:backup-52ebbec9b47b */
function backup(){if(currentUser().role!=='owner'){toast('Backup доступен владельцу');return}download(`MASTER_AI_backup_${today()}.json`,new Blob([JSON.stringify(backupPayload(),null,2)],{type:'application/json'}));log('backup','Скачан полный backup');dbWrite();toast('Backup скачан')}/* CRM_END:backup-52ebbec9b47b */
/* CRM_UNIT:restore-4a5cf24f52ad */
async function restore(file){try{const d=JSON.parse(await file.text());if(!Array.isArray(d.orders)||!Array.isArray(d.expenses))throw new Error('Неверный backup');if(!confirm(`Заменить текущую базу backup-файлом: ${d.orders.length} заказов?`))return;state.orders=d.orders;state.expenses=d.expenses;state.deletedOrders=Array.isArray(d.deletedOrders)?d.deletedOrders:[];state.settings={...state.settings,...(d.settings||{})};state.audit=Array.isArray(d.audit)?d.audit:[];log('backup','База восстановлена из backup');await dbWrite();applySettings();fillDatalists();refillFilters();refresh();setForm({});toast('Backup восстановлен')}catch(e){alert('Ошибка восстановления: '+e.message)}}/* CRM_END:restore-4a5cf24f52ad */
/* CRM_UNIT:applySettings-53a28fa277d1 */
function applySettings(){const s=state.settings||{};$('#s_company').value=s.company||'';$('#s_currency').value=s.currency||'RUB';$('#s_city').value='СПб';$('#s_dispatcher').value=s.dispatcher||'';$('#ppAsExpense').checked=!!s.ppAsExpense;const pv=(v,d)=>numMaybe(v)==null?d:num(v);$('#s_threshold1').value=pv(s.threshold1,4000);$('#s_threshold2').value=pv(s.threshold2,8000);$('#s_gridRates').value=`${pv(s.gridLow,30)} / ${pv(s.gridMid,40)} / ${pv(s.gridHigh,50)}`;$('#s_fixedRate').value=pv(s.fixedRate,50);$('#s_reviewBonus').value='5% · максимум 1 000 ₽';renderSettings()}/* CRM_END:applySettings-53a28fa277d1 */
/* CRM_UNIT:saveOpsSettings-0b157414e061 */
async function saveOpsSettings(){state.settings.shift1Name=clean($('#s_shift1Name').value)||'Смена Сергея';state.settings.shift2Name=clean($('#s_shift2Name').value)||'Смена Артёма';state.settings.shiftBasePay=Math.max(0,num($('#s_shiftBasePay').value)||2000);state.settings.shiftCashThreshold=Math.max(0,num($('#s_shiftCashThreshold').value)||20000);state.settings.shiftCashRate=Math.max(0,Math.min(100,num($('#s_shiftCashRate').value)||10));state.settings.assignSla=Math.max(1,num($('#s_assignSla').value)||15);state.settings.cashSla=Math.max(1,num($('#s_cashSla').value)||24);state.settings.aiMinSample=Math.max(2,num($('#s_aiMinSample').value)||5);state.settings.aiCityWeight=Math.max(0,Math.min(50,num($('#s_aiCityWeight').value)||20));state.settings.aiDirectionWeight=Math.max(0,Math.min(50,num($('#s_aiDirectionWeight').value)||25));state.settings.aiHighCheck=Math.max(0,num($('#s_aiHighCheck').value)||8000);state.settings.aiLookback=Math.max(30,Math.min(730,num($('#s_aiLookback').value)||120));state.settings.dailyRevenueTarget=Math.max(0,num($('#s_dailyRevenueTarget').value));state.settings.dailyCashTarget=Math.max(0,num($('#s_dailyCashTarget').value));state.settings.phoneEveningTime=clean($('#s_phoneEveningTime')?.value)||'18:00';state.settings.phoneNoTime=clean($('#s_phoneNoTime')?.value)||'09:00';state.settings.phoneNearestFutureTime=clean($('#s_phoneNearestFutureTime')?.value)||'09:00';await dbWrite();if(window.MasterAICloud?.connected&&currentUser().role==='owner')await window.MasterAICloud.savePayroll(state.settings);renderSettings();renderShiftClose();toast('Операционные настройки сохранены')}/* CRM_END:saveOpsSettings-0b157414e061 */
/* CRM_UNIT:renderSettings-8d3540859f1a */

function renderSettings(){const approx=JSON.stringify(backupPayload()).length;$('#storageInfo').innerHTML=`Рабочее состояние: <b>${state.orders.length} заказов</b>, <b>${state.expenses.length} расходов</b>. Backup ≈ <b>${(approx/1024/1024).toFixed(2)} МБ</b>.`;$('#audit').innerHTML=state.audit.slice(0,120).map(x=>`<div class="debate-item"><b>${esc(x.type)}</b><div>${esc(x.text)}</div><time>${new Date(x.at).toLocaleString('ru-RU')}</time></div>`).join('')||'<div class="muted">Журнал пуст</div>';$('#s_accessEnabled').checked=!!state.settings.accessEnabled;renderStaff();renderMasterRoster();const staffIsMaster=$('#staffRole').value==='master';$('#staffMasterWrap').hidden=!staffIsMaster;if($('#staffShiftWrap'))$('#staffShiftWrap').hidden=staffIsMaster;}/* CRM_END:renderSettings-8d3540859f1a */
/* CRM_UNIT:betaSeedLocal-0bb2d3f1e43d */


async function betaSeedLocal(force=false){
  if(!window.MASTER_AI_BETA||window.MASTER_AI_BETA_ONLINE)return null;
  if(force){const res=await fetch(BETA_RESET_API,{method:'POST',cache:'no-store'});if(!res.ok)throw new Error('BETA reset HTTP '+res.status);return await res.json()}
  let existing=await betaServerRead();
  if(!existing||!Array.isArray(existing.orders))throw new Error('BETA server state недоступен');
  if(!localStorage.getItem('MASTER_AI_BETA_MIGRATED_V18_16_5')){try{const legacy=await legacyIdbRead(),rows=Array.isArray(legacy?.orders)?legacy.orders:[],betaIds=rows.filter(x=>String(x?._id||'').startsWith('beta:')).length;if(rows.length>100&&betaIds>=Math.floor(rows.length*.8)){legacy.settings=betaSafeSettings(legacy.settings||{});legacy._betaMeta={...(legacy._betaMeta||{}),migratedFrom:'18.16.3-browser-indexeddb',migratedAt:new Date().toISOString()};await betaServerWrite(legacy);existing=await betaServerRead();console.info('BETA migrated legacy IndexedDB → server file',existing.orders.length)}}catch(e){console.warn('BETA legacy migration skipped',e)}finally{localStorage.setItem('MASTER_AI_BETA_MIGRATED_V18_16_5','1')}}
  return existing;
}/* CRM_END:betaSeedLocal-0bb2d3f1e43d */
/* CRM_UNIT:betaResetLocal-b34dc2e4f9fd */
async function betaResetLocal(){
  if(window.MASTER_AI_BETA_ONLINE){toast('Рабочий online-режим: локальный сброс отключён');return}
  if(!confirm('Сбросить локальную рабочую копию к исходному снимку?'))return;
  if(!confirm('Все локальные изменения будут удалены. Продолжить?'))return;
  await betaSeedLocal(true);
  betaClearRememberedLogin();
  localStorage.removeItem('MASTER_AI_V18_CONNECTION');
  localStorage.removeItem('MASTER_AI_V15_CONNECTION');
  localStorage.removeItem('MASTER_AI_V14_CONNECTION');
  location.reload();
}/* CRM_END:betaResetLocal-b34dc2e4f9fd */
