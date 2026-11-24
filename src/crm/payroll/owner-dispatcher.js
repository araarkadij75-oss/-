/* CRM_UNIT:weekDates-cb5f15db9132 */
function weekDates(anchor=$('#masterShiftDate')?.value||today()){const d=new Date(anchor+'T12:00:00');d.setDate(d.getDate()-((d.getDay()+6)%7));return Array.from({length:7},(_,i)=>{const x=new Date(d);x.setDate(d.getDate()+i);return iso(x)})}/* CRM_END:weekDates-cb5f15db9132 */
/* CRM_UNIT:shiftWeekLabel-b9210364f09b */
function shiftWeekLabel(day){return new Date(day+'T12:00:00').toLocaleDateString('ru-RU',{weekday:'short',day:'2-digit',month:'2-digit'})}/* CRM_END:shiftWeekLabel-b9210364f09b */
/* CRM_UNIT:weekRange-a071a18ef59e */
function weekRange(anchor){const days=weekDates(anchor);return{start:days[0],end:days[6],days}}/* CRM_END:weekRange-a071a18ef59e */
/* CRM_UNIT:uniqueShiftReports-80829dbf4114 */
function uniqueShiftReports(rows){const latest=new Map(),priority=r=>!r.closureOnly&&!r.draft&&(r.ownerConfirmed||r.dataHash)?1:0;for(const r of [...(rows||[])].sort((a,b)=>String(a.closedAt||'').localeCompare(String(b.closedAt||'')))){const key=String(r.date||'')+'-'+(payrollShiftKey(r)||String(r.shift||r.id||'')),previous=latest.get(key);if(previous&&priority(previous)>priority(r))continue;latest.set(key,r)}return[...latest.values()]}/* CRM_END:uniqueShiftReports-80829dbf4114 */
/* CRM_UNIT:loadOwnerWeekReports-70511cebd786 */async function loadOwnerWeekReports(){if(currentUser().role!=='owner'||!window.MasterAICloud?.connected||!$('#ownerWeekDate'))return;try{const range=weekRange($('#ownerWeekDate').value||today()),rows=await window.MasterAICloud.getShiftReportsForPeriod(range.start,range.end),ids=new Set(range.days);state.shiftReports=[...state.shiftReports.filter(r=>!ids.has(r.date)),...rows];renderWeeklyReports()}catch(e){toast('Не удалось обновить неделю: '+(e.message||e))}}/* CRM_END:loadOwnerWeekReports-70511cebd786 */
/* CRM_UNIT:payrollAccountingReport-8262249d3fbf */
function payrollAccountingReport(r){return !!r&&!r.closureOnly&&!r.draft&&!r.voided&&!!((r.ownerConfirmed&&r.subjectMemberId)||(r.dataHash&&r.closedBy))}/* CRM_END:payrollAccountingReport-8262249d3fbf */
/* CRM_UNIT:payrollAccountedIds-dec75e968adb */
function payrollAccountedIds(r){return payrollAccountingReport(r)?(Array.isArray(r.paidOrderIds)?r.paidOrderIds:Array.isArray(r.orderIds)?r.orderIds:[]).map(String):[]}/* CRM_END:payrollAccountedIds-dec75e968adb */
/* CRM_UNIT:payrollSchedule-1efca8b4814c */
function payrollSchedule(){const anchor=(typeof $==='function'?$('#payrollCycleAnchor')?.value:'')||state.settings?.payrollCycleAnchor||'2026-09-15',first=(typeof $==='function'?$('#payrollCycleStart')?.value:'')||state.settings?.payrollCycleStart||'artem';return{anchor,first}}/* CRM_END:payrollSchedule-1efca8b4814c */
/* CRM_UNIT:payrollSettlementLedger-14262713128c */
function payrollSettlementLedger(anchor=payrollSchedule().anchor,first=payrollSchedule().first){
 const reports=uniqueShiftReports(state.shiftReports||[]).filter(payrollAccountingReport).sort((a,b)=>String(a.date).localeCompare(String(b.date))),paid=new Map(),closedDays=new Set(reports.map(r=>payrollShiftKey(r)+'|'+r.date)),seen=new Set(),result=[];
 for(const report of reports){const who=payrollShiftKey(report);for(const id of payrollAccountedIds(report)){if(!paid.has(id))paid.set(id,{date:report.date,who})}}
 for(const r of state.orders||[]){if(r._duplicateOf)continue;const id=String(r.orderId||''),who=orderPayrollShift(r),cashDate=shiftCashRecordedDate(r);const accounted=paid.get(id),used=accounted?.date||'';if(!id||!who||seen.has(id)||(!used&&(!cashDate||!payrollOrderCashRecorded(r))))continue;seen.add(id);let assignedDate=used||cashDate;
 if(!used){let day=parseDate(cashDate);if(!day)continue;let attempts=0;const horizon=(reports.length+1)*4;while((payrollScheduledShift(iso(day),anchor,first)!==who||closedDays.has(who+'|'+iso(day)))&&attempts<horizon){day.setUTCDate(day.getUTCDate()+1);attempts++}if(attempts===horizon)continue;assignedDate=iso(day)}
 result.push({r,id,who,date:cashDate,assignedDate,cash:Math.round(num(r.companyShare)*100)/100,used,accountedWho:accounted?.who||''})}
 return result.sort((a,b)=>a.assignedDate.localeCompare(b.assignedDate)||a.id.localeCompare(b.id))
}/* CRM_END:payrollSettlementLedger-14262713128c */
/* CRM_UNIT:payrollScheduledShift-c1afebecd70e */
function payrollScheduledShift(date,anchor,first){const a=parseDate(anchor),d=parseDate(date);if(!a||!d)return'';const delta=Math.floor((Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())-Date.UTC(a.getFullYear(),a.getMonth(),a.getDate()))/86400000),phase=((delta%4)+4)%4;return phase<2?first:(first==='sergey'?'artem':'sergey')}/* CRM_END:payrollScheduledShift-c1afebecd70e */
/* CRM_UNIT:closeWeek-21ed3e4d901d */
async function closeWeek(){if(currentUser().role!=='owner')return;if(!window.MasterAICloud?.connected){toast('Нет связи с общей базой. Недельный отчёт не закрыт; подключитесь и повторите.');return}const anchor=$('#ownerWeekDate')?.value||today();if(weekRange(anchor).end>=today()){toast('Неделю можно закрыть после окончания воскресенья');return}let reports=state.shiftReports;try{if(window.MasterAICloud?.connected)reports=await window.MasterAICloud.getShiftReportsForPeriod(...Object.values(weekRange(anchor)).slice(0,2))}catch(e){toast('Не удалось загрузить отчёты недели: '+(e.message||e));return}const {start,end,days}=weekRange(anchor),ids=new Set(days);state.shiftReports=[...state.shiftReports.filter(r=>!ids.has(r.date)),...reports];const report=weeklySnapshot(anchor,reports);if(!report.closedShifts){toast('Нельзя закрыть неделю без закрытых смен');return}if(report.duplicateOrders){toast('В отчётах повторяются ID заказов. Исправьте дневные отчёты до закрытия недели.');return}const prior=state.weeklyShiftReports.find(x=>x.id===report.id);if(prior&&prior.sourceHash!==report.sourceHash&&!confirm('Дневные данные изменились. Пересчитать и заменить недельный итог?'))return;if(report.missingShifts&&!confirm('Не закрыто смен: '+report.missingShifts+' из '+report.expectedShifts+'. Сохранить отчёт с фактическими данными?'))return;try{let saved=report;if(window.MasterAICloud?.connected)saved=await window.MasterAICloud.closeWeek(report);state.weeklyShiftReports=[saved,...state.weeklyShiftReports.filter(x=>x.id!==saved.id)];await dbWrite();renderWeeklyReports();toast('Недельный отчёт закрыт')}catch(e){toast('Не удалось закрыть неделю: '+(e.message||e))}}/* CRM_END:closeWeek-21ed3e4d901d */
/* CRM_UNIT:shiftPayroll-47e7e3ed3cc7 */
function shiftPayroll(cash,s=state.settings){const base=Math.max(0,num(s.shiftBasePay)||2000),rate=Math.max(0,Math.min(100,num(s.shiftCashRate)||10));return Math.round(Math.max(base,Math.max(0,num(cash))*rate/100)*100)/100}/* CRM_END:shiftPayroll-47e7e3ed3cc7 */
/* CRM_UNIT:shiftOrderDate-452385374378 */
function shiftOrderDate(r){return iso(parseDate(r.visitDate||''))||iso(parseDate(r.callDate||''))||iso(parseDate(String(r._createdAt||'').slice(0,10)))}/* CRM_END:shiftOrderDate-452385374378 */
/* CRM_UNIT:shiftOrders-c3172a1a8ab9 */
function shiftOrders(date=today(),profile=currentUser()){return state.orders.filter(r=>!r._duplicateOf&&shiftOrderDate(r)===date&&orderMatchesDispatcher(r,profile))}/* CRM_END:shiftOrders-c3172a1a8ab9 */
/* CRM_UNIT:shiftSettlementDate-86078c009dca */
function shiftSettlementDate(r){return shiftCashRecordedDate(r)}/* CRM_END:shiftSettlementDate-86078c009dca */
/* CRM_UNIT:shiftSettlementOrders-6ae28aa841d7 */
function shiftSettlementOrders(date=today(),profile=currentUser(),reserved=new Set(),validationReport=null){const key=payrollShiftKey({shift:profile.shift||'',approvedForName:profile.name||''})||String(profile.shift||profile.id||''),validating=validationReport&&validationReport.date===date&&payrollShiftKey(validationReport)===key,accounted=new Set(validating?payrollAccountedIds(validationReport):[]),rows=payrollSettlementLedger().filter(x=>x.who===key&&x.assignedDate===date&&(validating?x.used===date&&accounted.has(x.id):!x.used)&&!reserved.has(x.id)).map(x=>x.r);if(rows.length>500)throw new Error('В расчёте больше 500 заказов: требуется разделение без потери сумм');return rows}/* CRM_END:shiftSettlementOrders-6ae28aa841d7 */
/* CRM_UNIT:legacyShiftSnapshot-24816aa9569e */
function legacyShiftSnapshot(date,profile){const rows=shiftOrders(date,profile),fin=rows.filter(r=>num(r.total)>0),done=rows.filter(r=>derivedStage(r)==='Выполнен'),reviews=rows.filter(r=>truthReview(r.review)).length,cash=sum(rows,r=>num(r.companyShare)),dataHash=pinHash(JSON.stringify(rows.map(r=>[r.orderId,r._updatedAt,r.total,r.companyShare,r.review,r.master,r._closeReviewState,r._assignedAt,r._status,derivedStage(r)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))));return{orders:rows.length,financialOrders:fin.length,completed:done.length,active:rows.filter(r=>!['Выполнен','Отказ','Отмена'].includes(derivedStage(r))).length,refused:rows.filter(r=>derivedStage(r)==='Отказ').length,cancelled:rows.filter(r=>derivedStage(r)==='Отмена').length,unassigned:rows.filter(r=>!['Выполнен','Отказ','Отмена'].includes(derivedStage(r))&&(!r.master||isServiceMaster(r.master))).length,reviewPending:rows.filter(r=>r._closeReviewState==='pending'||derivedStage(r)==='На проверке').length,reviews,reviewRate:done.length?reviews/done.length*100:0,turnover:sum(fin,r=>num(r.total)),cash,avgCheck:fin.length?sum(fin,r=>num(r.total))/fin.length:0,salary:shiftPayroll(cash),dataHash}}/* CRM_END:legacyShiftSnapshot-24816aa9569e */
/* CRM_UNIT:shiftSnapshot-8356621c5670 */
// Hash domain intake-v2 distinguishes the intake algorithm without altering the v1 report schema. Unprefixed saved reports retain legacy verification.
function shiftSnapshot(date=today(),profile=currentUser(),reserved=new Set(),validationReport=null,explicitWorkedDay=false){const legacy=!!validationReport&&!String(validationReport.dataHash||'').startsWith('intake-v2:'),intake=legacy?null:payrollIntakeSnapshot().days.find(d=>d.date===date&&d.person===payrollShiftKey({shift:profile.shift,approvedForName:profile.name})),cohortIds=new Set(intake?.orderIds||[]),seen=new Set(),rows=shiftOrders(date,profile),fin=rows.filter(r=>num(r.total)>0),done=rows.filter(r=>derivedStage(r)==='Выполнен'),reviews=rows.filter(r=>truthReview(r.review)).length,payable=legacy?shiftSettlementOrders(date,profile,reserved,validationReport):state.orders.filter(r=>{const id=String(r.orderId||r._id||'');if(!cohortIds.has(id)||seen.has(id)||r._duplicateOf)return false;seen.add(id);return true}),todayCash=payable.filter(r=>(legacy?shiftOrderDate(r):iso(parseDate(r.callDate||'')))===date),deferred=payable.filter(r=>(legacy?shiftOrderDate(r):iso(parseDate(r.callDate||'')))!==date),shiftCash=!legacy&&todayCash.some(r=>r._cashReceipts?.length)?intake.cashCents/100:sum(todayCash,r=>num(r.companyShare)),deferredCash=sum(deferred,r=>num(r.companyShare)),cash=shiftCash+deferredCash,paidOrderIds=payable.map(r=>String(r.orderId)),deferredOrderIds=deferred.map(r=>String(r.orderId)),dataHash=(legacy?'':'intake-v2:')+pinHash(JSON.stringify({rows:rows.map(r=>[r.orderId,r._updatedAt,r.total,r.companyShare,r.review,r.master,r._closeReviewState,r._assignedAt,r._status,derivedStage(r)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),paidOrderIds,shiftCash,deferredCash}));if(paidOrderIds.length>500)throw new Error('В начислении больше 500 заказов — требуется отдельная сверка');return{id:date+'-'+(profile.shift||profile.id||'shift'),date,closedBy:profile.id||'',closedByName:profile.name||'',shift:profile.shift||profile.id||'shift',shiftName:shiftName(profile.shift||profile.id),orders:rows.length,financialOrders:fin.length,completed:done.length,active:rows.filter(r=>!['Выполнен','Отказ','Отмена'].includes(derivedStage(r))).length,refused:rows.filter(r=>derivedStage(r)==='Отказ').length,cancelled:rows.filter(r=>derivedStage(r)==='Отмена').length,unassigned:rows.filter(r=>!['Выполнен','Отказ','Отмена'].includes(derivedStage(r))&&(!r.master||isServiceMaster(r.master))).length,reviewPending:rows.filter(r=>r._closeReviewState==='pending'||derivedStage(r)==='На проверке').length,reviews,reviewRate:done.length?reviews/done.length*100:0,turnover:sum(fin,r=>num(r.total)),cash,shiftCash,deferredCash,paidOrderIds,deferredOrderIds,settlementVersion:1,avgCheck:fin.length?sum(fin,r=>num(r.total))/fin.length:0,salary:legacy?shiftPayroll(cash):(intake?.entitlementCents||((date<=today()&&(explicitWorkedDay||(!legacy&&validationReport&&num(validationReport.salary)>=2000)))?200000:0))/100,basePay:num(state.settings.shiftBasePay)||2000,cashThreshold:num(state.settings.shiftCashThreshold)||20000,cashRate:num(state.settings.shiftCashRate)||10,orderIds:rows.map(r=>r.orderId).filter(Boolean).slice(0,500),lockedOrderIds:[...new Set([...rows.filter(r=>!isPickupOrder(r)).map(r=>String(r.orderId||'')),...payable.map(r=>String(r.orderId||'')),...state.orders.filter(r=>isPickupOrder(r)&&['Выполнен','Закрыт','Закрыто'].includes(derivedStage(r))&&(r.closeDate===date||r._cashClosedOn===date)&&orderMatchesDispatcher(r,profile)).map(r=>String(r.orderId||''))].filter(Boolean))].slice(0,500),dataHash}}/* CRM_END:shiftSnapshot-8356621c5670 */
/* CRM_UNIT:subscribeShiftCenter-65cb1a7c09e6 */
function subscribeShiftCenter(){window.MasterAICloud?.subscribeShiftReports?.(reports=>{state.shiftReports=reports||[];renderShiftClose();renderWeeklyReports()});window.MasterAICloud?.subscribeWeeklyReports?.(rows=>{state.weeklyShiftReports=rows||[];renderWeeklyReports()});window.MasterAICloud?.subscribeMasterShifts?.(rows=>{const incoming=rows||[],incomingIds=new Set(incoming.map(x=>x.date));mergeMasterShiftCache([...state.masterShifts.filter(x=>!incomingIds.has(x.date)),...incoming],weekDates());fillDatalists();if(!masterWeekDirty)renderMasterShifts();renderRecentMasters()});loadMasterWeek()}/* CRM_END:subscribeShiftCenter-65cb1a7c09e6 */
/* CRM_UNIT:shareShiftReport-ea312222b8dd */
function shiftHistoryCycles(rows,snapshot,renderDay){
 const {anchor,first}=payrollSchedule(),groups=new Map(),intakes=new Map();
 for(const order of state.orders||[]){
  const id=order.orderId||order._id;if(!id||order._duplicateOf)continue;
  const date=iso(parseDate(order.callDate)),key=orderPayrollShift(order)+'|'+date;
  if(!intakes.has(key))intakes.set(key,new Set());intakes.get(key).add(id);
 }
 const offset=(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
 for(const r of rows){
  const person=payrollShiftKey(r)||r.shift||r.id;
  let start=r.date,end=r.date;
  if(/^\d{4}-\d\d-\d\d$/.test(start)&&payrollScheduledShift(start,anchor,first)===person){
   const prev=offset(start,-1);if(payrollScheduledShift(prev,anchor,first)===person)start=prev;
   end=offset(start,1);
  }
  const key=JSON.stringify([person,start]);
  if(!groups.has(key))groups.set(key,{person,start,end,reports:[]});
  groups.get(key).reports.push(r);
 }
 return [...groups.values()].sort((a,b)=>String(b.start).localeCompare(String(a.start))).slice(0,20).map(g=>{
  const reports=g.reports.sort((a,b)=>String(a.date).localeCompare(String(b.date))),days=snapshot?.days.filter(d=>d.person===g.person&&reports.some(r=>r.date===d.date))||[];
  const dates=[...new Set(reports.map(r=>r.date))],ids=reports.map(r=>r.id).join('|');
  const orderIds=new Set(reports.flatMap(r=>r.orderIds||[]).filter(Boolean));
  const orders=orderIds.size+reports.reduce((n,r)=>n+Math.max(0,(Number(r.orders)||0)-(r.orderIds||[]).length),0);
  const totals=days.length?['Касса '+money(days.reduce((n,d)=>n+d.cashCents,0)/100),'из неё поздняя '+money(days.reduce((n,d)=>n+(d.lateCashCents||0),0)/100),'начислено '+money(days.reduce((n,d)=>n+d.entitlementCents,0)/100)]:[];
  const range=g.start===g.end?g.start:g.start+' — '+g.end;
  const stateLabel=g.start===g.end?'Вне графика':dates.length===2?'Оба дня закрыты':'Закрыт 1 из 2 дней';
  const title=(reports[0].shiftName||shiftName(g.person))+' · '+range;
  const received=dates.reduce((sum,date)=>sum+(intakes.get(g.person+'|'+date)?.size||0),0);
  const metrics='Принято: '+received+' · Заказы в отчётах: '+orders+(totals.length?' · '+totals.join(' · '):'');
  const summary=stateLabel+' · '+metrics;
  const daily=reports.map(r=>{
   const day=days.find(d=>d.date===r.date),count=r.closureOnly?(r.orderIds||[]).length:r.orders;
   const lines=[r.date+' · Принято: '+(intakes.get(g.person+'|'+r.date)?.size||0)+' · В отчёте: '+count];
   if(day){
    lines.push('Касса '+money(day.cashCents/100)+' · из неё поздняя '+money(day.lateCashCents/100));
    if(day.undatedCashCents)lines.push('В том числе без даты сдачи: '+money(day.undatedCashCents/100));
    lines.push('Начислено за день: '+money(day.entitlementCents/100));
   }
   return lines.join('\n');
  });
  const shareText=[title,summary,...daily].join('\n\n');
  return '<article class="shift-report-card"><div class="shift-report-title"><div><b>'+esc(title)+'</b><span class="shift-cycle-status" data-state="'+(g.start===g.end?'off':dates.length===2?'complete':'partial')+'">'+esc(stateLabel)+'</span><span class="shift-cycle-metrics">'+esc(metrics)+'</span></div><button type="button" class="btn small secondary" data-share-text="'+esc(shareText)+'" data-share-shift="'+esc(ids)+'">Поделиться сменой</button></div><details><summary>Отчёты по дням</summary>'+reports.map(renderDay).join('')+'</details></article>';
 }).join('');
}
function previewShiftReport(text){
 const dialog=document.getElementById('cycleSharePreview'),status=dialog.querySelector('[role=status]');
 dialog.querySelector('pre').textContent=text;
 status.textContent='';
 dialog.querySelector('[data-close-cycle]').onclick=()=>dialog.close();
 dialog.querySelector('[data-copy-cycle]').onclick=async()=>{
  try{await navigator.clipboard.writeText(text);status.textContent='Отчёт скопирован'}
  catch{status.textContent='Браузер ограничил копирование. Выделите текст отчёта и скопируйте вручную.'}
 };
 const send=dialog.querySelector('[data-send-cycle]');
 send.hidden=!navigator.share;
 send.onclick=async()=>{try{await navigator.share({title:'Отчёт за смену',text})}catch(e){if(e?.name!=='AbortError')status.textContent='Не удалось открыть отправку. Можно скопировать отчёт.'}};
 dialog.showModal();
}
async function shareShiftReport(r){r=r||state.shiftReports[0];if(!r){toast('Сначала закройте смену');return}const reports=Array.isArray(r)?r:[r];if(!reports.length)return;const text=reports.map(day=>day.closureOnly?(day.shiftName||shiftName(day.shift))+' · '+day.date+' · День закрыт, заказов: '+(day.orderIds||[]).length:shiftReportText(day)).join('\n\n');r=reports[0];try{if(navigator.share)await navigator.share({title:'Отчёт по смене',text});else{await navigator.clipboard.writeText(text);toast('Отчёт скопирован')}}catch(e){if(e?.name!=='AbortError'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));a.download=`shift-${r.date}.txt`;a.click();URL.revokeObjectURL(a.href)}}}/* CRM_END:shareShiftReport-ea312222b8dd */
/* CRM_UNIT:renderShiftReports-f6c11424f0a2 */

function renderShiftReports(){renderWeeklyReports()}/* CRM_END:renderShiftReports-f6c11424f0a2 */
