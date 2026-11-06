import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const read=p=>fs.readFileSync(p,'utf8');
test('staff payroll is authenticated, read-only and does not accept client employee identity',()=>{
 const source=read('hosted-snapshot/crm-api/own-payroll.php');
 assert.match(source,/\$actor=tg_jwt_actor\(\$pdo\)/);assert.doesNotMatch(source,/\$_(?:POST|GET)|php:\/\/input|tg_write_many|DELETE FROM|UPDATE crm_documents|INSERT INTO/);
 assert.match(source,/own_pay_order_person\(\$r,\$members\)!==\$person/);assert.match(source,/\$p\['person'\]\?\?''\)!==\$person/);
 assert.match(source,/unset\(\$d\['cashCents'\]\)/);
});
test('staff gets a personal payroll tab while operational orders remain accessible',()=>{
 for(const role of ['dispatcher','master']){
  const meta=read(`src/crm/staff/${role}.js`),html=read(`src/crm/roles/${role}.html`);
  assert.match(meta,/master:\{label:'Мастер',tabs:\['orders','mypayroll'\]/);
  assert.match(html,/data-tab="mypayroll"/);assert.match(html,/data-panel="mypayroll"/);assert.match(html,/own-payroll\.js/);
  const dispatch=meta.match(/dispatcher_logistic:\{label:[^}]+\}/)[0];assert.doesNotMatch(dispatch,/'dashboard'|'performance'|'reports'|'finance'|'profit'/);assert.match(dispatch,/'orders'/);
 }
});
test('personal payroll clears on identity changes and does not render stale responses',()=>{
 const source=read('hosted-snapshot/own-payroll.js');assert.match(source,/if\(id!==identity\)/);assert.match(source,/request!==generation\|\|id!==current\(\)/);assert.match(source,/cache:'no-store'/);assert.match(source,/dueCents/);assert.match(source,/Их нельзя повторно прибавлять к остатку/);
});
test('unknown-date sequence balance is not presented as an additional unpaid debt',()=>{
 const source=read('src/crm/payroll/owner.js');assert.match(source,/Датированный остаток с переносом/);assert.match(source,/Это не отдельный долг/);assert.match(source,/используйте общий остаток сотрудника выше/);
});
const php=spawnSync('php',['--version'],{encoding:'utf8'});
test('PHP personal payroll isolates users, applies late increments and paid baselines', {skip:php.error?'PHP CLI unavailable; required in release CI':false},()=>{const run=spawnSync('php',['tests/own-payroll.test.php'],{encoding:'utf8'});assert.equal(run.status,0,run.stdout+'\n'+run.stderr)});

test('sanitized live dataset matches the current owner engine and verified paid balances', async()=>{
 const vm=await import('node:vm'),f=JSON.parse(read('tests/fixtures/own-payroll-live-sanitized.json')),catalog=JSON.parse(read('src/crm/unit-catalog.json'));
 const names=['num','numMaybe','clean','norm','parseDate','iso','sum','derivedStage','payrollShiftKey','orderPayrollShift','uniqueShiftReports','payrollAccountingReport','payrollSchedule','payrollOrderCashRecorded','shiftCashRecordedDate','payrollIntakeSnapshot'];
 const unit=name=>{const e=catalog.owner.find(x=>x.symbols.includes(name));return read('src/crm/'+e.file).split('/* CRM_UNIT:'+e.id+' */')[1].split('/* CRM_END:'+e.id+' */')[0].trim()};
 const ctx={state:{orders:f.orders,shiftReports:f.reports,settings:{staff:f.members,payrollCycleAnchor:f.anchor,payrollCycleStart:f.first},payrollPayments:f.ledger,payrollPaymentsOwner:'owner',payrollPaymentsStatus:'loaded'},window:{MasterAICloud:{profile:{id:'owner'}}},Date,STATUS_ORDER:['Выполнен','В работе','Забор / техника у мастера'],$:()=>null,today:()=>f.cutoff};vm.createContext(ctx);vm.runInContext(read('hosted-snapshot/payroll-intake-accounting.js'),ctx);vm.runInContext(names.map(unit).join('\n')+';globalThis.result=payrollIntakeSnapshot()',ctx);const result=JSON.parse(JSON.stringify(ctx.result));assert.deepEqual(result.people,f.expected);assert.deepEqual(result.days,f.expectedDays);
 for(const r of f.orders)for(const k of ['phone','address','request','name','pin','token','email'])assert.equal(k in r,false);
});
test('staff payroll omits all-time earned and paid amounts from the main screen',()=>{
 const s=read('hosted-snapshot/own-payroll.js');assert.doesNotMatch(s,/Всего начислено|Уже выдано|money\(r\.earnedCents\)|money\(r\.paidCents\)/);assert.match(s,/<details><summary>Предыдущие циклы/);assert.match(s,/cycles\.slice\(0,1\)/);
});

test('personal payroll renders only its final balance and rejects a response after switching accounts',async()=>{
 const vm=await import('node:vm'),handlers={},box={textContent:'',innerHTML:''},button={disabled:false,addEventListener:(name,fn)=>handlers[name]=fn},tab={addEventListener(){}},intervals=[];
 const document={getElementById:id=>id==='ownPayrollResult'?box:button,querySelector:()=>tab,createElement:()=>({}),head:{appendChild(){}},visibilityState:'visible'};
 const profile={id:'sergey',role:'dispatcher_logistic'},cloud={connected:true,profile,getIdToken:async()=> 'test-session'};
 let resolveResponse;const response=()=>new Promise(resolve=>{resolveResponse=resolve});
 const context={document,window:{MasterAICloud:cloud},Intl,Date,AbortController,setTimeout,clearTimeout,setInterval:fn=>intervals.push(fn),fetch:response};vm.createContext(context);vm.runInContext(read('hosted-snapshot/own-payroll.js'),context);
 const payload={ok:true,kind:'dispatcher',cutoff:'2026-11-06',earnedCents:9000000,paidCents:8800000,dueCents:200000,warnings:[],cycles:[{start:'2026-11-04',end:'2026-11-05',earnedCents:450000}],days:[{date:'2026-11-04',earnedCents:250000,orderIds:['own-order']}]};
 const first=handlers.click();await new Promise(setImmediate);resolveResponse({ok:true,json:async()=>payload});await first;
 assert.match(box.innerHTML,/Осталось к выплате/);assert.doesNotMatch(box.innerHTML,/90.?000|88.?000|Всего начислено|Уже выдано/);assert.match(box.innerHTML,/own-order/);
 const second=handlers.click();await new Promise(setImmediate);cloud.profile={id:'artem',role:'dispatcher_logistic'};resolveResponse({ok:true,json:async()=>({...payload,days:[{date:'2026-11-04',earnedCents:250000,orderIds:['stale-secret-order']}]})});await second;
 assert.doesNotMatch(box.innerHTML,/stale-secret-order/);
});
