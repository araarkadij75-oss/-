import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../hosted-snapshot/profit-ui.js',import.meta.url),'utf8');
const start=source.indexOf('  function expensePayload('),end=source.indexOf('  async function action(',start);
const context={money:n=>String(n)+' ₽',owner:()=>true,window:{MasterAICloud:{connected:true,getIdToken:async()=> 'test'}},fetch:async()=>({ok:true,json:async()=>({ok:true,expenses:[]})})};
const methods=vm.runInNewContext(source.slice(start,end)+';({expensePayload,api})',context);
test('Preview expenses and credits preserve cents and stable operation identity',()=>{
 const expense=methods.expensePayload({date:'2026-10-31',amount:1234.56,operationId:'op-1',description:'Продвижение'},' cabinet ');
 assert.equal(expense.amountCents,123456);assert.equal(expense.kind,'expense');assert.equal(expense.externalId,'op-1');assert.equal(expense.account,'cabinet');
 const refund=methods.expensePayload({date:'2026-10-31',amount:-12.5,key:'stable-row'});
 assert.equal(refund.amountCents,1250);assert.equal(refund.kind,'refund');assert.equal(refund.externalId,'stable-row');
 for(const amount of [0,NaN,Infinity])assert.throws(()=>methods.expensePayload({date:'2026-10-31',amount}));
});
test('Finance writes fail closed without owner access and reject non-success API',async()=>{
 let calls=0;context.fetch=async()=>{calls++;return{ok:false,status:409,json:async()=>({ok:false})}};
 context.owner=()=>false;await assert.rejects(methods.api('import',{rows:[]}),/владельцу/);assert.equal(calls,0);
 context.owner=()=>true;await assert.rejects(methods.api('import',{rows:[]}),/конфликт/);assert.equal(calls,1);
});

test('Import errors distinguish funding from expenses and conflicting operation IDs',()=>{
 const a=source.indexOf('  function importIssue('),b=source.indexOf('  function mapping()',a);
 const issue=vm.runInNewContext(source.slice(a,b)+';importIssue');
 assert.match(issue({code:'ambiguous_operation_type'}),/Пополнение баланса не является расходом/);
 assert.match(issue({code:'conflicting_operation_id'}),/разными данными/);
 assert.match(issue({code:'invalid_date'}),/дата/);
});

test('Monthly statistics payload preserves explicit period instead of publication date',()=>{
 const row=methods.expensePayload({date:'2026-10-31',periodFrom:'2026-10-01',periodTo:'2026-10-31',amount:1250.5,bonus:75.25,statisticId:'ad123',operationId:'avito-stat:account:ad:oct'});
 assert.equal(row.date,'2026-10-31');assert.equal(row.periodFrom,'2026-10-01');assert.equal(row.periodTo,'2026-10-31');assert.equal(row.amountCents,125050);assert.equal(row.statisticId,'ad123');assert.match(row.note,/75.25 ₽.*сумму расхода не меняют/);
});

test('Mount transfers an already active legacy finance view after handlers are ready',()=>{
 const transfer="if(anchor.classList.contains('active'))tab.onclick();";
 assert.ok(source.indexOf(transfer)>source.indexOf("$('#profitImportConfirm').onclick="));
 let opened=0;
 for(const active of [false,true])vm.runInNewContext(transfer,{anchor:{classList:{contains:()=>active}},tab:{onclick:()=>opened++}});
 assert.equal(opened,1);
});

test('Finance UI is removed when owner connection is lost',()=>{const line=source.split('\n').find(x=>x.includes('const owner ='));let data={connected:true,role:'owner'};const check=vm.runInNewContext(line+';owner',{snapshot:()=>data});assert.equal(check(),true);data.connected=false;assert.equal(check(),false);data={connected:true,role:'master'};assert.equal(check(),false)});

test('Finance period opens on cash dates and follows Moscow midnight',()=>{
  assert.match(source, /id="profitBasis" class="select"><option value="cash">/);
  const from=source.indexOf('  function moscowDate('),to=source.indexOf('  function renderPeriodSections(',from);
  const date=vm.runInNewContext(source.slice(from,to)+';moscowDate',{Intl});
  assert.equal(date(new Date('2026-11-24T21:00:00Z')),'2026-11-25');
  assert.equal(date(new Date('2026-11-24T20:59:59Z')),'2026-11-24');
});

test('Period breakdown keeps current estimates distinct and flags cross-day expense coverage',()=>{
  const nodes = Object.fromEntries(['#profitPeriodSections','#profitPeriodBody','#profitPeriodHint'].map(key=>[key,{}]));
  const from=source.indexOf('  function renderPeriodSections('),to=source.indexOf('  function render() {',from);
  const render=vm.runInNewContext(source.slice(from,to)+';renderPeriodSections',{$:key=>nodes[key],money:n=>n+' ₽',esc:s=>String(s).replaceAll('<','&lt;')});
  const completed={from:'2026-11-01',to:'2026-11-24',companyCash:10000,salary:2000,ads:1900,other:0,profit:6100};
  const today={from:'2026-11-25',to:'2026-11-25',companyCash:5000,salary:2000,ads:0,other:20,profit:2980,issues:['Сверить <расход>']};
  render({companyCash:15000,salary:4000,ads:1900,other:20,profit:9080,periodSections:{completed,today}});
  assert.match(nodes['#profitPeriodBody'].innerHTML,/Завершённые дни.*01.11.2026 – 24.11.2026.*6100 ₽/);
  assert.match(nodes['#profitPeriodBody'].innerHTML,/Сегодня · день открыт.*2980 ₽.*&lt;расход/);
  assert.match(nodes['#profitPeriodHint'].textContent,/Чистый расход на рекламу/);
  assert.doesNotMatch(nodes['#profitPeriodHint'].textContent,/Сумма строк отличается/);
  render({companyCash:15000,salary:4000,ads:2100,other:20,profit:8880,periodSections:{completed,today}});
  assert.match(nodes['#profitPeriodHint'].textContent,/Сумма строк отличается/);
  render({...completed,periodSections:{completed,today:null}});
  assert.doesNotMatch(nodes['#profitPeriodBody'].innerHTML,/Сегодня/);
  assert.equal(nodes['#profitPeriodHint'].hidden,true);
});
