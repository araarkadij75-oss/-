import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import '../hosted-snapshot/payroll-intake-accounting.js';
const html=fs.readFileSync(new URL('../hosted-snapshot/index.html',import.meta.url),'utf8');
const ownerSource=fs.readFileSync(new URL('../src/crm/payroll/owner.js',import.meta.url),'utf8');
const source=html.match(/function payrollCycleUiStatus\(c\)\{[^\n]+\}/)[0];
const status=vm.runInNewContext('('+source+')');
test('cycle distinguishes provisional and confirmed accrual without claiming payment',()=>{
 const pending={saved:null,salary:4500}; const confirmed={saved:4500,salary:4700};
 assert.match(status(pending),/Предварительно.*требует сверки/);
 assert.match(status(confirmed),/подтверждённых отчётах.*не отметка выплаты/);
 assert.match(status({saved:0}),/подтверждённых отчётах/);
 assert.deepEqual(pending,{saved:null,salary:4500});
 assert.deepEqual(confirmed,{saved:4500,salary:4700});
});
test('payroll navigation separates daily verification and two-day totals',()=>{
 assert.match(html,/data-tab="shiftclose">Проверка смен/);
 assert.match(html,/data-tab="payrollcycles">Зарплата · 2 дня/);
 assert.match(html,/Закрытые смены · расчёт по двухдневным циклам/);
 assert.match(html,/каждое начисление учитывается один раз/);
});
test('cycle details retain order actions and mark missing settlement date as unresolved',()=>{
 const body=ownerSource.slice(ownerSource.indexOf('function renderPayrollCycleRegister(){'),ownerSource.indexOf('function ',ownerSource.indexOf('function renderPayrollCycleRegister(){')+20));
 assert.match(body,/<details><summary>Заказы:/);
 assert.match(body,/payrollIntakeSnapshot\(\)/);
 assert.match(body,/data-owner-shift-order/);
 assert.match(body,/<th>Принят<\/th><th>Сдан<\/th>/);
 assert.match(body,/o.cashDate\|\|'Нет даты'/);
 assert.match(body,/Ожидает подтверждённой сдачи/);
 assert.match(body,/остаток по отдельным циклам не распределяется/);
 assert.match(body,/p\.paidCents\/100/);
 assert.match(body,/p\.dueCents\/100/);
});

function renderHarness(month='2026-10',person='all'){
 const names=['renderDailyPayrollReconciliation','renderPayrollCycleRegister','renderPendingPayroll'];
 const script=ownerSource;
 const ast=parse(script,{ecmaVersion:'latest',sourceType:'module'});
 const functions=names.map(n=>{const node=ast.body.find(x=>x.type==='FunctionDeclaration'&&x.id.name===n);assert.ok(node,n);return script.slice(node.start,node.end)}).join('\n');
 const days=[{date:'2026-10-31',person:'sergey',cashCents:2500000,earnedCents:250000,orderIds:['late-order','undated-order']},{date:'2026-11-01',person:'sergey',cashCents:1500000,earnedCents:200000},{date:'2026-10-29',person:'artem',cashCents:3000000,earnedCents:300000,orderIds:['artem-order']}];
 const snapshot={cutoff:'2026-11-02',baselines:[],payments:[],events:[],days,people:[{person:'sergey',earnedCents:450000,paidCents:400000,dueCents:50000,overpaidCents:0},{person:'artem',earnedCents:300000,paidCents:350000,dueCents:0,overpaidCents:50000}],orders:[{id:'late-order',person:'sergey',intakeDate:'2026-10-31',cashDate:'2026-11-02',cashCents:2500000,closed:true},{id:'undated-order',person:'sergey',intakeDate:'2026-10-31',cashDate:'',cashCents:100000,closed:true},{id:'invalid-receipt-order',person:'sergey',intakeDate:'2026-10-31',cashDate:'2026-10-30',cashCents:500000,closed:true},{id:'duplicate-order',duplicateOf:'late-order',person:'sergey',intakeDate:'2026-10-31',cashDate:'2026-11-02',cashCents:2500000,closed:true},{id:'artem-order',person:'artem',intakeDate:'2026-10-29',cashDate:'2026-10-29',cashCents:3000000,closed:true}],warnings:[]};
 const nodes={};const before=JSON.stringify(snapshot);const context={state:{payrollPaymentsOwner:'owner',payrollPaymentsStatus:'loaded',payrollPayments:[]},window:{PayrollIntakeAccounting:globalThis.PayrollIntakeAccounting,MasterAICloud:{connected:true,profile:{id:'owner'}}},crypto:{randomUUID:()=> 'fixed-test-id'},$:id=>nodes[id]||(nodes[id]={value:id.includes('Month')?month:id.includes('Person')?person:'',innerHTML:'',insertAdjacentHTML(position,text){this.innerHTML=position==='afterbegin'?text+this.innerHTML:this.innerHTML+text},dataset:{},querySelectorAll:()=>[],querySelector:()=>({}),reportValidity:()=>true}),currentUser:()=>({role:'owner'}),ownerPreviewActive:()=>false,today:()=> '2026-11-02',payrollIntakeSnapshot:()=>snapshot,renderHistoricalPayroll(){},bindBackfill(){},payrollSchedule:()=>({anchor:'2026-10-31',first:'sergey'}),payrollScheduledShift:d=>['2026-10-31','2026-11-01'].includes(d)?'sergey':'artem',iso:d=>d.toISOString().slice(0,10),money:n=>Number(n).toFixed(2),integer:String,esc:String};
 vm.runInNewContext(functions+';renderDailyPayrollReconciliation();renderPayrollCycleRegister();renderPendingPayroll();',context);assert.equal(JSON.stringify(snapshot),before,'render must not change accounting data');return nodes;
}
test('late order stays in intake cycle with both dates; duplicates excluded and missing cash date unresolved',()=>{
 const nodes=renderHarness('2026-10','sergey'),body=nodes['#payrollCycleRegisterTable'].innerHTML;
 assert.match(body,/2026-10-31 — 2026-11-01/);assert.match(body,/data-owner-shift-order="late-order"/);assert.match(body,/2026-11-02/);
 assert.match(body,/Нет даты/);assert.match(body,/Касса учтена · дата сдачи неизвестна/);assert.doesNotMatch(body,/duplicate-order|artem-order/);
 assert.match(body,/Уже выплачено/);assert.match(body,/4000\.00/);assert.match(body,/<b>500\.00<\/b>/);
 assert.match(nodes['#latePayrollQueue'].innerHTML,/late-order/);assert.doesNotMatch(nodes['#latePayrollQueue'].innerHTML,/undated-order|duplicate-order/);
});
test('month changes daily accrual but never subtracts all-time payments from a monthly subtotal',()=>{
 const oct=renderHarness('2026-10','sergey'),nov=renderHarness('2026-11','sergey');
 assert.match(oct['#dailyPayrollReconciliationTable'].innerHTML,/2500\.00/);assert.doesNotMatch(oct['#dailyPayrollReconciliationTable'].innerHTML,/2026-11-01/);
 assert.match(nov['#dailyPayrollReconciliationTable'].innerHTML,/2000\.00/);assert.doesNotMatch(nov['#dailyPayrollReconciliationTable'].innerHTML,/2026-10-31/);
 assert.equal(oct['#payrollCyclePayoutTable'].innerHTML,nov['#payrollCyclePayoutTable'].innerHTML);
 assert.equal(oct['#payrollAccrualTable'].innerHTML,nov['#payrollAccrualTable'].innerHTML);
 assert.match(nov['#payrollCyclePayoutTable'].innerHTML,/Переплата/);assert.match(nov['#payrollCyclePayoutTable'].innerHTML,/<b>0\.00<\/b>/);
});

test("owner shift heading describes verification rather than personal shift",()=>{
 const panel=html.split('data-panel="shiftclose"')[1].split("</section>")[0];
 assert.match(panel,/<div class="chart-title">Проверка смен<\/div>/);
 assert.match(panel,/текущий расчёт по заказам с сохранённым отчётом/);
 assert.match(panel,/не означает выплату денег/);
 assert.doesNotMatch(panel,/Моя смена|Личные итоги дня/);
});
test('archive describes its real date range and never claims a current unfinished shift',()=>{
 const fn=vm.runInNewContext('('+html.match(/function historicalPayrollScopeLabel\(data,archived\)\{[^\n]+\}/)[0]+')');
 const data={days:[{date:'2026-10-10'},{date:'2026-09-15'}]};
 assert.match(fn(data,true),/Архивный снимок.*2026-09-15 — 2026-10-10.*не отражают последующие изменения/);
 assert.match(fn(data,false),/Подтверждённые отчёты CRM/);
 assert.equal(data.days[0].date,'2026-10-10');
 assert.match(html,/не текущий статус смены/);
 assert.doesNotMatch(html,/план: 2 смены × 7 дней|сумма выплат по сменам/);
 assert.match(html,/план: 1 смена × 7 дней/);
 assert.match(html,/сумма начислений по сменам/);
 assert.doesNotMatch(html,/\+' ₽ на смену'/);
});

 test('cycle accounting labels follow ledger inclusion rather than closure flag alone',()=>{
 const body=renderHarness('2026-10','sergey')['#payrollCycleRegisterTable'].innerHTML;
 const row=id=>body.slice(body.indexOf('data-owner-shift-order="'+id+'"')).split('</tr>')[0];
 assert.match(row('undated-order'),/Нет даты.*Касса учтена · дата сдачи неизвестна/);
 assert.doesNotMatch(row('undated-order'),/Ожидает подтверждённой сдачи/);
 assert.match(row('late-order'),/В кассе дня приёма/);
 assert.match(row('invalid-receipt-order'),/Ожидает подтверждённой сдачи/);
 assert.doesNotMatch(row('invalid-receipt-order'),/В кассе дня приёма|Касса учтена/);
});
