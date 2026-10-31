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
