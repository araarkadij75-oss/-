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
 assert.deepEqual(m.shiftSettlementOrders('2026-10-19',{shift:'sergey'}).map(x=>x.orderId),['closure','draft']);assert.equal(m.payrollSettlementLedger().find(x=>x.id==='paid').used,'2026-10-19');
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
