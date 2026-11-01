import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const html=fs.readFileSync(new URL('../hosted-snapshot/index.html',import.meta.url),'utf8');
const line=name=>html.slice(html.indexOf('function '+name+'(')).split('\n')[0];
const num=x=>Number(x)||0;
const iso=d=>d?d.toISOString().slice(0,10):'';
const parseDate=x=>/^\d{4}-\d\d-\d\d$/.test(x||'')?new Date(x+'T12:00:00Z'):null;
function model(orders=[],reports=[]){
 const state={orders,shiftReports:reports,settings:{shiftBasePay:2000,shiftCashRate:10}};
 const helpers=html.slice(html.indexOf('function payrollAccountingReport('),html.indexOf('function payrollOrdersFor('));
 const src=helpers+line('payrollOrdersFor')+'\n'+line('shiftPayroll')+'\n'+line('shiftSettlementDate')+'\n'+line('shiftSettlementOrders')+'\n'+line('payrollDailyEstimate');
 const scheduled=d=>['2026-10-19','2026-10-20','2026-10-23','2026-10-24'].includes(d)?'sergey':'artem';
 return new Function('state','num','iso','parseDate','uniqueShiftReports','payrollShiftKey','orderPayrollShift','shiftCashRecordedDate','payrollOrderCashRecorded','payrollScheduledShift','norm','derivedStage',src+';return {state,payrollDailyEstimate,shiftPayroll,payrollSettlementLedger,shiftSettlementOrders,shiftSettlementDate,payrollAccountingReport,payrollOrdersFor}')(
 state,num,iso,parseDate,r=>r,r=>r.shift,r=>r.dispatcher,r=>r.closeDate||'',r=>r.status==='Выполнен'&&r.companyShare>0,scheduled,x=>String(x||'').toLowerCase(),r=>r.status);
}
const order=(id,date,cash=10000,dispatcher='sergey')=>({orderId:id,closeDate:date,companyShare:cash,dispatcher,status:'Выполнен',visitDate:'2026-10-01'});
test('daily guarantee applies independently and preserves kopecks',()=>{
 const m=model();assert.equal(m.shiftPayroll(25000)+m.shiftPayroll(15000),4500);assert.equal(m.shiftPayroll(40675),4067.5);assert.equal(m.shiftPayroll(21000,{shiftBasePay:2000,shiftCashRate:5}),2000);
});
test('old intake and off-duty closures are assigned once to next working day',()=>{
 const m=model([order('old','2026-10-17'),order('other','2026-10-18',3000,'artem'),order('day2','2026-10-20')]);
 const ledger=m.payrollSettlementLedger();assert.equal(ledger.find(x=>x.id==='old').assignedDate,'2026-10-19');assert.deepEqual(m.payrollOrdersFor({id:'sergey'},'2026-10-19',ledger).map(x=>x.orderId),['old']);assert.equal(ledger.find(x=>x.id==='day2').assignedDate,'2026-10-20');
});
test('undated completed orders and duplicate IDs cannot inflate settlement',()=>{
 const a=order('a','2026-10-19');const m=model([a,{...a},order('undated','')]);
 assert.equal(m.payrollSettlementLedger().length,1);assert.deepEqual(m.shiftSettlementOrders('2026-10-19',{shift:'sergey'}).map(x=>x.orderId),['a']);assert.equal(m.shiftSettlementDate(order('undated','')),'');
});
test('confirmed legacy IDs stay reserved but closure-only or draft reports do not consume pay',()=>{
 const reports=[{date:'2026-10-19',shift:'sergey',ownerConfirmed:true,subjectMemberId:'s',orderIds:['paid']},{date:'2026-10-19',shift:'sergey',ownerConfirmed:true,subjectMemberId:'s',closureOnly:true,paidOrderIds:['closure']},{date:'2026-10-19',shift:'sergey',draft:true,paidOrderIds:['draft']}];
 const m=model(['paid','closure','draft'].map(id=>order(id,'2026-10-19')),reports);
 assert.deepEqual(m.shiftSettlementOrders('2026-10-20',{shift:'sergey'}).map(x=>x.orderId),['closure','draft']);assert.equal(m.payrollSettlementLedger().find(x=>x.id==='paid').used,'2026-10-19');
});
test('future dates produce no preview accrual; confirmed salaries remain frozen',()=>{
 const start=html.indexOf('function renderDailyPayrollReconciliation('),end=html.indexOf('function renderPayrollCycleRegister(',start),body=html.slice(start,end);
 const expression=body.match(/estimated=(.*?);row\.people/)[1];
 const calculate=new Function('date','today','frozen','report','onShift','shiftPayroll','cash','num','return '+expression);
 assert.equal(calculate('2026-11-01',()=> '2026-10-31',false,null,true,model().shiftPayroll,25000,num),null);
 assert.equal(calculate('2026-10-20',()=> '2026-10-31',true,{salary:1234.5},true,model().shiftPayroll,25000,num),1234.5);
});

test('pending estimate groups cents by day and excludes future or accounted entries',()=>{const m=model();const result=m.payrollDailyEstimate([{assignedDate:'2026-10-19',cash:25000},{assignedDate:'2026-10-20',cash:15000},{assignedDate:'2026-11-01',cash:90000},{assignedDate:'2026-10-20',cash:90000,used:'2026-10-20'}],'2026-10-31');assert.deepEqual(result,{days:2,salary:4500})});

test('a date on an active order is not proof of received cash',()=>{const source=line('payrollOrderCashRecorded');const check=new Function('num','derivedStage','return ('+source+')')(num,r=>r.status);assert.equal(check({status:'В работе',closeDate:'2026-10-19',companyShare:9000}),false);assert.equal(check({status:'В работе',_cashClosedOn:'2026-10-19',companyShare:9000}),true);assert.equal(check({status:'Выполнен',closeDate:'2026-10-19',companyShare:9000}),true)});

function snapshotModel(m){return new Function('state','shiftOrders','num','derivedStage','truthReview','shiftSettlementOrders','shiftOrderDate','sum','pinHash','shiftName','isServiceMaster','isPickupOrder','shiftPayroll',line('shiftSnapshot')+';return shiftSnapshot')(m.state,()=>[],num,r=>r.status,()=>false,m.shiftSettlementOrders,r=>r.visitDate,(rows,fn)=>rows.reduce((total,r)=>total+fn(r),0),x=>x,x=>x,()=>false,()=>false,m.shiftPayroll)}
test('closing day two before day one does not merge daily guarantees or consume late carry twice',()=>{const m=model([order('late','2026-10-17',5000),order('day1','2026-10-19',20000),order('day2','2026-10-20',15000)]);const snap=snapshotModel(m),profile={id:'sergey',shift:'sergey'};const second=snap('2026-10-20',profile);assert.equal(second.cash,15000);assert.equal(second.salary,2000);assert.deepEqual(second.paidOrderIds,['day2']);const first=snap('2026-10-19',profile);assert.equal(first.cash,25000);assert.equal(first.salary,2500);assert.equal(first.salary+second.salary,4500);assert.deepEqual(first.paidOrderIds,['day1','late']);m.state.shiftReports.push({...second,ownerConfirmed:true,subjectMemberId:'sergey'});assert.equal(snap('2026-10-19',profile).salary,2500);assert.deepEqual(snap('2026-10-20',profile).paidOrderIds,[])});
test('shared schedule respects settings and the same explicit owner preview override',()=>{const run=new Function('state','$',line('payrollSchedule')+';return payrollSchedule');const state={settings:{payrollCycleAnchor:'2026-10-01',payrollCycleStart:'sergey'}};assert.deepEqual(run(state,()=>null)(),{anchor:'2026-10-01',first:'sergey'});assert.deepEqual(run(state,s=>({value:s.includes('Anchor')?'2026-10-05':'artem'}))(),{anchor:'2026-10-05',first:'artem'})});

test('accounted undated orders stay on their report day but never reenter payable drafts',()=>{const m=model([order('saved','',7500),order('pending','',9000)],[{date:'2026-10-19',shift:'sergey',ownerConfirmed:true,subjectMemberId:'sergey',paidOrderIds:['saved'],cash:7500,salary:2000}]);const ledger=m.payrollSettlementLedger();assert.equal(ledger.length,1);assert.equal(ledger[0].date,'');assert.equal(ledger[0].assignedDate,'2026-10-19');assert.equal(ledger[0].used,'2026-10-19');assert.equal(ledger[0].cash,7500);assert.deepEqual(m.shiftSettlementOrders('2026-10-19',{shift:'sergey'}),[]);assert.equal(m.state.shiftReports[0].salary,2000)});

test('newly imported old closure skips frozen workdays and carries to next unsettled shift',()=>{const reports=['2026-10-21','2026-10-22'].map(date=>({date,shift:'artem',ownerConfirmed:true,subjectMemberId:'artem',paidOrderIds:[],cash:25000,salary:2500}));const m=model([order('imported','2026-10-21',7500,'artem')],reports);const item=m.payrollSettlementLedger()[0];assert.equal(item.date,'2026-10-21');assert.equal(item.assignedDate,'2026-10-25');assert.equal(item.used,'');assert.deepEqual(m.shiftSettlementOrders('2026-10-21',{shift:'artem'}),[]);assert.deepEqual(m.shiftSettlementOrders('2026-10-25',{shift:'artem'}).map(x=>x.orderId),['imported']);assert.equal(snapshotModel(m)('2026-10-25',{id:'artem',shift:'artem'}).cash,7500);assert.deepEqual(m.payrollDailyEstimate([item],'2026-10-25'),{days:1,salary:2000});assert.deepEqual(m.state.shiftReports.map(r=>r.salary),[2500,2500])});

test('payroll ownership uses exact aliases and never overrides an explicit unknown dispatcher',()=>{const state={settings:{staff:[{id:'s',name:'Сергей',shift:'sergey',role:'dispatcher_logistic'},{id:'a',name:'Артём',shift:'artem',role:'dispatcher_logistic'},{id:'m',name:'Мартин',shift:'other',role:'dispatcher_logistic'}]}};const api=new Function('state','norm',line('payrollShiftKey')+'\n'+line('orderPayrollShift')+';return {payrollShiftKey,orderPayrollShift}')(state,x=>String(x||'').trim().toLowerCase().replace(/ё/g,'е'));assert.equal(api.orderPayrollShift({dispatcher:'Мартин',_createdBy:'a',_createdByShift:'artem'}),'');assert.equal(api.orderPayrollShift({dispatcher:'Виктор',_createdBy:'s',_createdByShift:'sergey'}),'');assert.equal(api.orderPayrollShift({dispatcher:'Артем',_createdBy:'s'}),'artem');assert.equal(api.orderPayrollShift({dispatcher:' Сергей ',_createdBy:'a'}),'sergey');assert.equal(api.orderPayrollShift({_createdBy:'s'}),'sergey');assert.equal(api.payrollShiftKey({id:'2026-10-21-artem'}),'artem');assert.equal(api.payrollShiftKey({approvedForName:'Сергеева'}),'');assert.equal(api.payrollShiftKey({shiftName:'Смена Сергея'}),'sergey')});


test('two-day payout render binds backfill for empty and populated periods without outer function scope',()=>{const helper=line('bindBackfill'),render=line('renderTwoDayPayrollPayouts');for(const populated of [false,true]){const box={innerHTML:''},button={onclick:null};let writes=0;const backfill=()=>writes++;const scheduled=date=>populated&&(date==='2026-10-01'||date==='2026-10-02')?'sergey':'';const run=new Function('$','state','uniqueShiftReports','today','payrollScheduledShift','norm','payrollShiftKey','shiftIntegrity','parseDate','iso','esc','num','money','backfillClosedHistoricalShifts',helper+'\n'+render+';return renderTwoDayPayrollPayouts')(id=>id==='#payrollCyclePayoutTable'?box:id==='#backfillClosedShifts'?button:null,{shiftReports:[],settings:{staff:[]}},x=>x,()=> '2026-10-31',scheduled,x=>String(x),r=>r.shift,()=>false,parseDate,iso,String,num,String,backfill);run(2026,10,'2026-09-15','artem',[]);assert.equal(typeof button.onclick,'function');assert.equal(writes,0);assert.match(box.innerHTML,populated?/<table/:/Нет завершённых|нет завершённых/);button.onclick();assert.equal(writes,1)}});


test('saved allocation verifies against itself without making orders payable again',()=>{const m=model([order('paid','2026-10-19',25000)]),snapshot=snapshotModel(m),profile={id:'sergey',name:'Сергей',shift:'sergey'};m.state.settings.staff=[profile];const report={...snapshot('2026-10-19',profile),ownerConfirmed:true,subjectMemberId:'sergey'};m.state.shiftReports.push(report);const integrity=new Function('state','shiftSnapshot','num',line('shiftIntegrity')+';return shiftIntegrity')(m.state,snapshot,num);assert.equal(integrity(report),true);Object.assign(m.state.orders[0],{_reportLockId:report.id,_updatedBy:'owner',_updatedByName:'Владелец'});assert.equal(integrity(report),true);assert.deepEqual(m.shiftSettlementOrders('2026-10-19',profile),[]);m.state.orders[0].companyShare=30000;assert.equal(integrity(report),false);assert.equal(report.salary,2500)});
test('settlement overflow fails instead of silently losing cash',()=>{const m=model(Array.from({length:501},(_,i)=>order('o'+i,'2026-10-19',100)));assert.throws(()=>m.shiftSettlementOrders('2026-10-19',{shift:'sergey'}),/500/)});
test('canonical report identity merges legacy shift aliases and keeps accounting report over later closure',()=>{const norm=x=>String(x||'').toLowerCase().replace(/ё/g,'е');const unique=new Function('norm',line('payrollShiftKey')+'\n'+line('uniqueShiftReports')+';return uniqueShiftReports')(norm);const paid={id:'p',date:'2026-10-19',shift:'1',closedAt:'2026-10-20',ownerConfirmed:true};const closure={id:'c',date:'2026-10-19',shift:'sergey',closedAt:'2026-10-21',closureOnly:true};assert.deepEqual(unique([paid,closure]),[paid]);assert.equal(unique([paid,{...paid,id:'new',shift:'sergey',closedAt:'2026-10-22'}])[0].id,'new')});
test('weekly schedule needs seven reports, detects paid IDs rather than visit IDs, and hashes allocations',()=>{const body=html.slice(html.indexOf('function weeklySnapshot('),html.indexOf('async function loadOwnerWeekReports('));const norm=x=>String(x||'').toLowerCase().replace(/ё/g,'е');const code=line('payrollShiftKey')+'\n'+line('uniqueShiftReports')+'\n'+line('payrollAccountingReport')+'\n'+line('payrollAccountedIds')+'\n'+body+';return weeklySnapshot';const run=new Function('state','weekRange','shiftIntegrity','sum','num','pinHash','norm',code)({},()=>({start:'2026-10-19',end:'2026-10-25'}),()=>true,(rows,fn)=>rows.reduce((n,r)=>n+fn(r),0),num,x=>x,norm);const rows=Array.from({length:7},(_,i)=>({id:'r'+i,date:'2026-10-'+(19+i),shift:i%2?'artem':'sergey',ownerConfirmed:true,subjectMemberId:'s',orderIds:['same-visit'],paidOrderIds:['paid'+i],salary:2000,cash:1000,orders:1}));const full=run('',rows);assert.equal(full.expectedShifts,7);assert.equal(full.missingShifts,0);assert.equal(full.partial,false);assert.equal(full.duplicateOrders,0);const conflict=run('',[...rows,{...rows[0],id:'other',shift:'artem'}]);assert.equal(conflict.partial,true);assert.equal(conflict.closedShifts,8);const changed=rows.map((r,i)=>i===1?{...r,paidOrderIds:['paid0']}:r);assert.equal(run('',changed).duplicateOrders,1);assert.notEqual(run('',changed).sourceHash,full.sourceHash)});


test('weekly save rejects duplicate dates before performing any database write',async()=>{const start=html.indexOf('cloud.closeWeek=async report=>{'),end=html.indexOf(';',html.indexOf('return{id,...payload}}',start))+1;const source=html.slice(start,end).replace(/^cloud.closeWeek=/,'').replace(/;$/,'');const save=new Function('cloud','return ('+source+')')({profile:{role:'owner'}});await assert.rejects(()=>save({closedShifts:8,dailyReports:[]}),/несколько отчётов/);await assert.rejects(()=>save({closedShifts:2,dailyReports:[{date:'2026-10-19'},{date:'2026-10-19'}]}),/несколько отчётов/)});


test('owner history compares saved allocation for the subject, with current cash and salary consistently',()=>{const own=order('own','2026-10-23',28900);own.visitDate='2026-10-23';const late=order('late','2026-10-23',2800);const m=model([own,late]),profile={id:'sergey',name:'Сергей',shift:'sergey'};m.state.settings.staff=[profile,{id:'owner',name:'Владелец',shift:''}];const snapshot=snapshotModel(m),report={...snapshot('2026-10-23',profile),id:'2026-10-23-sergey',ownerConfirmed:true,subjectMemberId:'sergey',closedBy:'owner'};m.state.shiftReports=[report];const compare=new Function('state','shiftSnapshot',line('shiftReportComparison')+';return shiftReportComparison')(m.state,snapshot);const before=JSON.stringify(report);let current=compare(report);assert.equal(current.shiftCash,28900);assert.equal(current.deferredCash,2800);assert.equal(current.salary,3170);own.companyShare=30000;late.companyShare=4000;current=compare(report);assert.equal(current.shiftCash,30000);assert.equal(current.deferredCash,4000);assert.equal(current.salary,3400);assert.equal(JSON.stringify(report),before);const box={innerHTML:''};const body=html.split('\n').find(x=>x.includes("$('#shiftReportHistory').innerHTML=rows.length?"));const render=new Function('state','uniqueShiftReports','$','$$','role','shiftIntegrity','shiftReportComparison','esc','shiftName','money','integer','pct',body.replace(/}\s*$/,''));render(m.state,x=>x,()=>box,()=>[],'owner',()=>false,compare,String,String,String,String,String);assert.match(box.innerHTML,/Своя касса <b>30000/);assert.match(box.innerHTML,/Поздние закрытия <b>4000/);assert.match(box.innerHTML,/Зарплата <b>3400/);assert.match(box.innerHTML,/Сохранено: 3170/);assert.equal(JSON.stringify(report),before)});

for(const role of ['index','dispatcher-logistic','master'])test(role+': dispatcher ownership is shared by filters, drilldown and shifts',()=>{
 const src=fs.readFileSync(new URL('../hosted-snapshot/'+role+'.html',import.meta.url),'utf8');
 const fn=name=>src.slice(src.indexOf('function '+name+'(')).split('\n')[0];
 const norm=x=>String(x||'').trim().toLowerCase().replaceAll('ё','е');
 const state={settings:{staff:[{id:'s',name:'Сергей',role:'dispatcher',shift:'artem'},{id:'a',name:'Артём',role:'dispatcher_logistic',shift:'sergey'}]},orders:[]};
 const helpers=['payrollShiftKey','orderPayrollShift','orderDispatcherName','orderMatchesDispatcher'].map(fn).join('\n');
 const m=new Function('state','norm',helpers+';return {orderPayrollShift,orderMatchesDispatcher,orderDispatcherName}')(state,norm);
 const sergey={dispatcher:'Сергей',_createdBy:'a',_createdByShift:'artem',_assignedBy:'a',_cashClosedBy:'a'};
 assert.equal(m.orderPayrollShift(sergey),'sergey');assert.equal(m.orderPayrollShift({dispatcher:'  Сергей  '}),'sergey');assert.equal(m.orderPayrollShift({dispatcher:' Артём '}),'artem');
 assert.equal(m.orderMatchesDispatcher(sergey,state.settings.staff[0]),true);
 assert.equal(m.orderMatchesDispatcher(sergey,state.settings.staff[1]),false);
 assert.equal(m.orderPayrollShift({_createdBy:'a'}),'artem');
 assert.equal(m.orderPayrollShift({_createdByName:'Сергей',_createdByShift:'artem'}),'sergey');
 assert.equal(m.orderMatchesDispatcher({dispatcher:'Другой',_createdBy:'s'},state.settings.staff[0]),false);
 assert.equal(m.orderDispatcherName({_createdBy:'a'}),'Артём');
 assert.match(fn('filterRows'),/orderPayrollShift\(r\)/);
 assert.doesNotMatch(fn('filterRows'),/r\._createdByShift/);
 assert.match(fn('matchesDrill'),/orderPayrollShift\(r\)/);
 assert.match(fn('shiftOrders'),/orderMatchesDispatcher\(r,profile\)/);
 assert.match(fn('group'),/orderDispatcherName\(r\)/);
 assert.doesNotMatch(fn('setForm'),/shiftName\(r\._createdByShift\)/);
 assert.match(fn('formRecord'),/!existing&&\['dispatcher','dispatcher_logistic'\]\.includes\(currentRole\(\)\)/);
 const perf=src.slice(src.indexOf('function renderTeamPerformance('),src.indexOf('function aiEligibleMasters('));
 assert.match(perf,/cr=rows\.filter\(r=>orderPayrollShift\(r\)===sh\)/);assert.doesNotMatch(perf,/ids\.has\(r\._cashClosedBy\)/);
 const shift={value:'sergey'},disp={value:'Артём',options:[{value:''},{value:'Сергей'},{value:'Артём'}]};
 const sync=new Function('$','norm',fn('payrollShiftKey')+'\n'+fn('syncDispatcherShiftFilter')+';return syncDispatcherShiftFilter')(id=>id==='#dashboardShift'?shift:disp,norm);
 sync('dashboardShift');assert.equal(disp.value,'Сергей');disp.value='Артём';sync('dispFilter');assert.equal(shift.value,'artem');disp.value='Другой';sync('dispFilter');assert.equal(shift.value,'');
});

for(const role of ['index','dispatcher-logistic','master'])test(role+': editing an imported order preserves its dispatcher and creation identity',async()=>{
 const src=fs.readFileSync(new URL('../hosted-snapshot/'+role+'.html',import.meta.url),'utf8');
 const body=src.slice(src.indexOf('async function upsertOne(')).split('\n')[0];
 const writes=[],cloud={profile:{id:'a',name:'Артём',shift:'artem'},versions:new Map([['old','v1']])};
 const batch={set:(ref,data)=>writes.push({ref,data}),commit:async()=>{}};
 const save=new Function('cloud','fs','db','orderDoc','dispatchDoc','stripUndefined','dispatcherEditable','dispatchSafe',body+';return upsertOne')(cloud,{writeBatch:()=>batch,setDoc:async(ref,data)=>writes.push({ref,data})},{},id=>'order/'+id,id=>'dispatch/'+id,x=>x,x=>x,x=>x);
 await save({orderId:'old',dispatcher:'Сергей'},'dispatcher');
 assert.equal(writes[0].data.dispatcher,'Сергей');assert.equal(writes[0].data._createdBy,undefined);assert.equal(writes[0].data._updatedBy,'a');
 writes.length=0;await save({orderId:'new'},'dispatcher');assert.equal(writes[0].data.dispatcher,'Артём');assert.equal(writes[0].data._createdBy,'a');
});

for(const role of ['index','dispatcher-logistic','master'])test(role+': dispatcher filter resolves the selected name once, not once per order',()=>{
 const src=fs.readFileSync(new URL('../hosted-snapshot/'+role+'.html',import.meta.url),'utf8');
 const body=src.slice(src.indexOf('function filterRows(')).split('\n')[0];
 let lookups=0;const rows=Array.from({length:1632},(_,i)=>({dispatcher:i%2?' Сергей ':'Артём'}));
 const norm=x=>String(x||'').trim().toLowerCase().replaceAll('ё','е');
 const filter=new Function('$','parseDate','numMaybe','state','roleVisibleOrders','orderDate','canonicalKey','canonicalDispatcherSelection','orderDispatcherName','matchesDrill',body+';return filterRows')(
 id=>({value:id==='#dispFilter'?'Сергей':''}),()=>null,()=>null,{orders:rows},x=>x,()=>null,norm,x=>{lookups++;return x},r=>r.dispatcher,()=>true);
 assert.equal(filter().length,816);assert.equal(lookups,1);
});

test('dispatcher late pickup queue uses the same responsible dispatcher as its payout',()=>{
 const src=fs.readFileSync(new URL('../hosted-snapshot/dispatcher-logistic.html',import.meta.url),'utf8');
 const queue=src.slice(src.indexOf('function renderPendingPayroll(')).split('\n')[0];
 assert.ok(queue);assert.match(queue,/orderMatchesDispatcher\(r,p\)/);assert.doesNotMatch(queue,/_createdByShift|_createdBy===/);
});

for(const role of ['index','dispatcher-logistic','master'])test(role+': analytics drill keeps dispatcher scope while ordinary order list stays global',()=>{
 const src=fs.readFileSync(new URL('../hosted-snapshot/'+role+'.html',import.meta.url),'utf8');
 const fn=name=>src.slice(src.indexOf('function '+name+'(')).split('\n')[0];
 const rows=Array.from({length:1274},(_,i)=>({orderId:String(i),dispatcher:i<172?'artem':'sergey'}));
 const state={orders:rows,drill:{type:'closed',analyticsScope:true},session:{}};
 const current=new Function('state','filterRows','roleVisibleOrders','$','norm','matchesDrill','currentRole','orderDate',fn('currentOrderRows')+';return currentOrderRows')(
 state,()=>rows.filter(r=>r.dispatcher==='artem'),r=>r,()=>({value:'',getAttribute:()=>null}),x=>String(x||''),()=>true,()=> 'owner',()=>null);
 assert.equal(current().length,172);state.drill=null;assert.equal(current().length,1274);
 const controls=new Map([['.tab.active',{dataset:{tab:'dashboard'}}],['#dispFilter',{value:'Артём'}],['#dashboardShift',{value:'artem'}]]);
 for(const id of ['orderSearch','orderStageFilter','masterWorkflowFilter'])controls.set('#'+id,{value:'stale'});
 for(const id of ['todayOrdersFilter','tomorrowOrdersFilter'])controls.set('#'+id,{setAttribute(k,v){this[k]=v}});
 const apply=new Function('state','$','renderDrillBanner','switchTab','renderOrders','shiftName','let orderPage=4;'+fn('setDrill')+';return setDrill')(state,id=>controls.get(id),()=>{},()=>{},()=>{},x=>x);
 apply('closed','','Выполнено');assert.equal(state.drill.analyticsScope,true);assert.match(state.drill.label,/Артём/);
 assert.equal(controls.get('#orderSearch').value,'');assert.equal(controls.get('#todayOrdersFilter')['aria-pressed'],'false');
 controls.get('.tab.active').dataset.tab='orders';apply('closed');assert.equal(state.drill.analyticsScope,false);
});

test('a paid order cannot become payable again after its dispatcher changes',()=>{
 const report={id:'2026-10-18-artem',date:'2026-10-18',shift:'artem',salary:2000,cash:1500,paidOrderIds:['moved'],dataHash:'saved',closedBy:'owner'};
 const m=model([order('moved','2026-10-17',1500,'sergey')],[report]);
 const entry=m.payrollSettlementLedger().find(x=>x.id==='moved');
 assert.equal(entry.who,'sergey');assert.equal(entry.accountedWho,'artem');assert.equal(entry.used,'2026-10-18');assert.equal(entry.assignedDate,'2026-10-18');
 assert.equal(m.shiftSettlementOrders('2026-10-19',{shift:'sergey'}).length,0);assert.equal(m.payrollDailyEstimate('sergey','2026-10-24').salary,0);
 assert.equal(report.salary,2000);assert.equal(report.cash,1500);
});

test('linked duplicate is excluded from current ledger while frozen report stays unchanged',()=>{const a=order('canonical','2026-10-19',2400),b={...order('duplicate','2026-10-19',2400),_duplicateOf:'canonical'},report={date:'2026-10-19',shift:'sergey',ownerConfirmed:true,subjectMemberId:'s',paidOrderIds:['canonical','duplicate'],salary:2480};const m=model([a,b],[report]);assert.deepEqual(m.payrollSettlementLedger().map(x=>x.id),['canonical']);assert.equal(report.salary,2480);assert.deepEqual(report.paidOrderIds,['canonical','duplicate']);const sum=new Function('return ('+line('sum')+')')();assert.equal(sum([a,b],r=>r.companyShare),2400);b._duplicateOf='';assert.equal(sum([a,b],r=>r.companyShare),4800)});

test('duplicate linkage is retained in read projections but never offered by staff-editable payloads',()=>{for(const role of ['index','dispatcher-logistic','master']){const source=fs.readFileSync(new URL('../hosted-snapshot/'+role+'.html',import.meta.url),'utf8');for(const name of role==='master'?['dispatcherEditable']:['dispatcherEditable','orderCloseSafe']){const match=source.match(new RegExp('const '+name+'=r=>\\{const ks=\\[([^\\]]+)\\]'));assert.ok(match);assert.ok(!match[1].includes('_duplicateOf'));}assert.match(source,/const dispatchSafe=r=>\{const ks=\['orderId','_duplicateOf'/)}});
