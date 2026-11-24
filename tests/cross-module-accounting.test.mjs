import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
const root=new URL('../',import.meta.url),catalog=JSON.parse(fs.readFileSync(new URL('src/crm/unit-catalog.json',root),'utf8'));
function unit(name,role='owner'){const entry=catalog[role].find(x=>x.symbols.includes(name));assert.ok(entry,`${role}:${name}`);const file=fs.readFileSync(new URL('src/crm/'+entry.file,root),'utf8');return file.split('/* CRM_UNIT:'+entry.id+' */')[1].split('/* CRM_END:'+entry.id+' */')[0].trim();}
const names=['num','numMaybe','clean','norm','parseDate','iso','sum','derivedStage','payrollShiftKey','orderPayrollShift','uniqueShiftReports','payrollAccountingReport','payrollAccountedIds','payrollSchedule','payrollScheduledShift','payrollSettlementLedger','payrollOrderCashRecorded','shiftCashRecordedDate','shiftPayroll','shiftOrderDate','orderMatchesDispatcher','shiftOrders','hasRecordedCashSurrenderOn','payrollIntakeSnapshot','collectRecordedCash'];
function model(orders=[],reports=[]){const state={orders,shiftReports:reports,payrollPaymentsOwner:'owner',payrollPaymentsStatus:'loaded',payrollPayments:[],settings:{payrollCycleAnchor:'2026-10-19',payrollCycleStart:'sergey',shiftBasePay:2000,shiftCashRate:10,staff:[]}},ctx={state,window:{MasterAICloud:{profile:{id:'owner'}}},Date,STATUS_ORDER:['Выполнен','В работе','Забор / техника у мастера'],$:()=>null,today:()=> '2026-10-20'};vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('hosted-snapshot/payroll-intake-accounting.js',root),'utf8'),ctx);vm.runInContext(names.map(n=>unit(n)).join('\n')+';globalThis.api={'+names.join(',')+'}',ctx);return {...ctx.api,state,ctx};}
const order=(id,date,cash,extra={})=>({orderId:id,dispatcher:'Сергей',callDate:'2026-10-01',visitDate:'2026-10-19',closeDate:date,companyShare:cash,_status:'Выполнен',...extra});
test('source units retain daily minimum and cents in every role output',()=>{for(const role of ['owner','dispatcher','master']){const f=new Function('state','num',unit('shiftPayroll',role)+';return shiftPayroll')({settings:{}},Number);assert.equal(f(25000)+f(15000),4500);assert.equal(f(40675),4067.5);const output=fs.readFileSync(new URL('hosted-snapshot/'+({owner:'index',dispatcher:'dispatcher-logistic',master:'master'}[role])+'.html',root),'utf8');assert.ok(output.includes(unit('shiftPayroll',role)));}});
test('cross-module ledger carries late cash once and preserves frozen salaries and missing-date allocations',()=>{const reports=[{id:'2026-10-19-sergey',date:'2026-10-19',shift:'sergey',ownerConfirmed:true,subjectMemberId:'s',paidOrderIds:['paid','undated-paid'],salary:2700}];const m=model([order('late','2026-10-17',25000),order('paid','2026-10-17',2000),order('undated-paid','',1000),order('undated','',7000),order('duplicate','2026-10-20',25000,{_duplicateOf:'late'})],reports),ledger=m.payrollSettlementLedger();assert.equal(ledger.find(x=>x.id==='late').assignedDate,'2026-10-20');assert.equal(ledger.find(x=>x.id==='paid').used,'2026-10-19');assert.equal(ledger.find(x=>x.id==='undated-paid').assignedDate,'2026-10-19');assert.equal(ledger.some(x=>x.id==='undated'||x.id==='duplicate'),false);assert.equal(reports[0].salary,2700);assert.equal(m.shiftPayroll(ledger.filter(x=>!x.used).reduce((s,x)=>s+x.cash,0)),2500);});
test('real payroll ledger and profit bridge preserve paid report and exclude semantic duplicate',()=>{const report={date:'2026-10-19',shift:'sergey',ownerConfirmed:true,subjectMemberId:'s',paidOrderIds:['a','b'],salary:3000};const m=model([order('a','2026-10-19',25000,{callDate:'2026-10-19'}),order('b','2026-10-19',25000,{callDate:'2026-10-19',_duplicateOf:'a'}),order('day2','2026-10-20',15000,{callDate:'2026-10-20'})], [report]);const window={MasterAICloud:{connected:true},addEventListener(){}};vm.runInNewContext(fs.readFileSync(new URL('hosted-snapshot/profit-accounting.js',root),'utf8'),{window,Date});vm.runInNewContext(fs.readFileSync(new URL('hosted-snapshot/profit-bridge.js',root),'utf8'),{window,Date});window.installMasterAIProfitBridge({...m,state:m.state,currentRole:()=> 'owner',ownerPreviewActive:()=>false,today:()=> '2026-10-20'});window.MasterAIProfitBridge.setReports(m.state.shiftReports);const r=window.MasterAIProfitBridge.calculate('2026-10-19','2026-10-20',[],'cash');assert.equal(r.cash,40000);assert.equal(r.salaryConfirmed,2500);assert.equal(r.salaryEstimated,2000);assert.equal(r.profit,35500);assert.equal(report.salary,3000);});

test('duplicate is excluded consistently from both daily order list and money ledger',()=>{const m=model([order('a','2026-10-19',2400),order('b','2026-10-19',2400,{_duplicateOf:'a'})]);assert.equal(m.payrollSettlementLedger().length,1);assert.equal(m.shiftOrders('2026-10-19',{id:'s',name:'Сергей',shift:'sergey'}).length,1);});
test('Today, salary ledger and profit agree on timestamp-only receipt',()=>{const row=order('receipt','2026-10-19',8600,{_status:'В работе',_cashClosedAt:'2026-10-19T10:00:00Z'}),m=model([row]);assert.equal(m.hasRecordedCashSurrenderOn(row,'2026-10-19'),true);assert.equal(m.payrollSettlementLedger()[0].cash,8600);const window={MasterAICloud:{connected:true},addEventListener(){}};vm.runInNewContext(fs.readFileSync(new URL('hosted-snapshot/profit-accounting.js',root),'utf8'),{window,Date});vm.runInNewContext(fs.readFileSync(new URL('hosted-snapshot/profit-bridge.js',root),'utf8'),{window,Date});window.installMasterAIProfitBridge({...m,state:m.state,currentRole:()=> 'owner',ownerPreviewActive:()=>false,today:()=> '2026-10-20'});window.MasterAIProfitBridge.setReports([]);assert.equal(window.MasterAIProfitBridge.calculate('2026-10-19','2026-10-19',[],'cash').cash,8600);});

function reportBridge(rows, now) {
 const m=model(rows);
 m.ctx.today=()=>now;
 const window={MasterAICloud:{connected:true},addEventListener(){}};
 for(const file of ['profit-accounting.js','profit-bridge.js']){
  vm.runInNewContext(fs.readFileSync(new URL('hosted-snapshot/'+file,root),'utf8'),{window,Date});
 }
 window.installMasterAIProfitBridge({...m,currentRole:()=> 'owner',ownerPreviewActive:()=>false,today:()=>now});
 window.MasterAIProfitBridge.setReports([]);
 return window.MasterAIProfitBridge;
}

test('closed-period intake freezes late portions while cash days show each actual receipt once',()=>{
 const b=reportBridge([
  order('split','2026-10-20',24500,{callDate:'2026-10-19',_cashReceipts:[
   {date:'2026-10-19',cents:2000000},{date:'2026-10-20',cents:450000}]}),
  order('new','2026-10-20',7000,{callDate:'2026-10-20',dispatcher:'Артём'})
 ],'2026-10-20');
 const intake=b.calculate('2026-10-19','2026-10-20',[],'intake');
 assert.equal(intake.cash,31500);
 assert.equal(intake.salary,4450);
 assert.equal(intake.periodSections.completed.asOf,'2026-10-19');
 assert.equal(intake.periodSections.completed.cash,20000);
 assert.equal(intake.periodSections.completed.salaryConfirmed,2000);
 assert.equal(intake.periodSections.completed.salaryEstimated,0);
 assert.equal(intake.periodSections.today.cash,7000);
 const cash=b.calculate('2026-10-19','2026-10-20',[],'cash');
 assert.equal(cash.periodSections.today.cash,11500);
 assert.equal(cash.periodSections.today.salary,2450);
 assert.equal(cash.periodSections.today.profit+cash.periodSections.completed.profit,cash.profit);
 const past=b.calculate('2026-10-19','2026-10-19',[],'cash');
 assert.equal(past.asOf,'2026-10-19');
 assert.equal(past.cash,20000);
 assert.equal(past.periodSections.today,null);
});

test('unknown dispatcher is flagged on affected intake and receipt dates, not unrelated closed days',()=>{
 const b=reportBridge([
  order('bad','2026-10-21',1000,{callDate:'2026-10-19',dispatcher:'Неизвестный'}),
  order('old','2026-10-19',20500,{callDate:'2026-10-19'}),
  order('valid','2026-10-20',26000,{callDate:'2026-10-20',dispatcher:'Артём'})
 ],'2026-10-22');
 for(const basis of ['cash','intake']){
  const clean=b.calculate('2026-10-20','2026-10-20',[],basis);
  assert.equal(clean.salaryConfirmed,2600);
  assert.equal(clean.salaryEstimated,0);
  assert.equal(clean.warnings.length,0);
 }
 const affected=b.calculate('2026-10-19','2026-10-19',[],'intake');
 assert.equal(affected.salaryEstimated,2050);
 assert.match(affected.warnings.join(' '),/неизвестным ответственным/);
 const late=b.calculate('2026-10-21','2026-10-21',[],'cash');
 assert.match(late.warnings.join(' '),/распознанного диспетчера/);
 assert.equal(late.cash,1000);
});

test('undated cash is visible today without retroactively inventing an earlier payment',()=>{
 const b=reportBridge([order('undated','',24000,{callDate:'2026-10-20'})],'2026-10-22');
 const intake=b.calculate('2026-10-20','2026-10-20',[],'intake');
 assert.equal(intake.cash,24000);
 assert.equal(intake.salaryConfirmed,2400);
 assert.equal(intake.periodSections.completed.cash,0);
 assert.equal(intake.periodSections.completed.salary,2000);
 assert.match(intake.periodSections.completed.warnings.join(' '),/дата поступления неизвестна/);
 const earlier=b.calculate('2026-10-19','2026-10-19',[],'cash');
 assert.equal(earlier.cash,0);
 assert.equal(earlier.warnings.length,0);
 const later=b.calculate('2026-10-21','2026-10-21',[],'cash');
 assert.match(later.warnings.join(' '),/Без даты нельзя определить/);
});

test('a newly accepted open order with no dispatcher explains the missing daily salary only on its intake day',()=>{
 const b=reportBridge([order('unknown','',0,{callDate:'2026-10-20',dispatcher:'',_status:'В работе'})],'2026-10-20');
 const r=b.calculate('2026-10-19','2026-10-20',[],'intake');
 assert.equal(r.periodSections.completed.warnings.length,0);
 assert.equal(r.periodSections.today.salary,0);
 assert.match(r.periodSections.today.warnings.join(' '),/Принятых заявок без установленного диспетчера: 1/);
});

test('production profit clock rolls over at Moscow midnight and passes the observation day to payroll',()=>{
 const window={MasterAICloud:{connected:true},addEventListener(){}};
 class Clock extends Date {constructor(...args){super(...(args.length?args:['2026-10-20T21:00:02Z']));}}
 for(const file of ['profit-accounting.js','profit-bridge.js']){
  vm.runInNewContext(fs.readFileSync(new URL('hosted-snapshot/'+file,root),'utf8'),{window,Date:Clock});
 }
 const cutoffs=[];
 const m=model([]);
 window.installMasterAIProfitBridge({...m,currentRole:()=> 'owner',ownerPreviewActive:()=>false,today:undefined,
  payrollIntakeSnapshot:(cutoff,observed)=>{cutoffs.push([cutoff,observed]);return {days:[],events:[],warnings:[]};}});
 window.MasterAIProfitBridge.setReports([]);
 const r=window.MasterAIProfitBridge.calculate('2026-10-20','2026-10-21',[],'intake');
 assert.deepEqual(cutoffs,[['2026-10-21','2026-10-21'],['2026-10-20','2026-10-21']]);
 assert.equal(r.periodSections.today.to,'2026-10-21');
});
test('dated customer refunds reverse only company cash and only the excess above the original day floor',()=>{
 const refund={id:'refund-1',date:'2026-10-20',companyCents:150000,masterCents:150000};
 const row=order('refund-order','2026-10-19',22500,{callDate:'2026-10-19',masterAmount:2500,_cashRefunds:[refund]});
 const m=model([row,row]);
 const cutoff='2026-10-20';
 const ledger=m.collectRecordedCash([row,row],{basis:'closeDate',cutoff});
 assert.deepEqual(Array.from(ledger,e=>[e.date,e.cashCents]),[['2026-10-19',2250000],['2026-10-20',-150000]]);
 assert.equal(m.collectRecordedCash([row],{basis:'callDate',cutoff:'2026-10-19'})[0].cashCents,2250000);
 assert.equal(m.collectRecordedCash([row],{basis:'callDate',cutoff})[0].cashCents,2100000);
 const snap=m.payrollIntakeSnapshot(cutoff,cutoff);
 assert.equal(snap.days[0].entitlementCents,210000);
 assert.equal(snap.events.find(e=>e.kind==='cash_refund').amountCents,-15000);
 const account=m.ctx.window.PayrollIntakeAccounting;
 const cycle=baseline=>account.settlementSequence({...snap,baselines:[{person:'sergey',date:baseline.date,days:[{date:'2026-10-19',cashCents:baseline.cash}]}]},{anchor:'2026-10-19',first:'sergey'}).cycles;
 assert.equal(cycle({date:'2026-10-19',cash:2250000}).flatMap(c=>c.events).reduce((s,e)=>s+e.amountCents,0),-15000);
 assert.equal(cycle({date:'2026-10-20',cash:2100000}).flatMap(c=>c.events).reduce((s,e)=>s+e.amountCents,0),0);
 const api=m.ctx.window;
 vm.runInContext(fs.readFileSync(new URL('hosted-snapshot/profit-accounting.js',root),'utf8'),m.ctx);
 const profit=api.ProfitAccounting.calculate({from:cutoff,to:cutoff,orders:[{id:'o',date:cutoff,closed:true,cash:-1500}],salaries:[{person:'sergey',date:cutoff,amount:-150,hasRefundAdjustment:true,confirmed:true}]});
 assert.equal(profit.profit,-1350);
 assert.equal(account.refundFlows({...snap.orders[0],_cashRefunds:[refund,refund]}),null);
 assert.equal(account.refundFlows({...snap.orders[0],_cashRefunds:[{...refund,companyCents:2300000}]}),null);
});
