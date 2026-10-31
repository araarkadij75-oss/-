import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
for(const page of ['index','master','dispatcher-logistic'])for(const role of ['owner','master','dispatcher','logistic','dispatcher_logistic'])test(`${page}: new order permissions for ${role} do not throw`,()=>{
 const html=fs.readFileSync(new URL(`../hosted-snapshot/${page}.html`,import.meta.url),'utf8');
 const source=html.match(/^function applyOrderFormPermissions\(\).*$/m)[0];
 const statuses=['В работе','Будущая дата','Отказ','Отмена','Выполнен'];
 const buttons=statuses.map(status=>({dataset:{status},disabled:false}));
 const elements=new Map();
 const node=()=>({disabled:false,hidden:false,style:{},options:[],querySelectorAll:()=>[],closest:()=>null,setAttribute(){},removeAttribute(){}});
 for(const id of ['f_status','f_master','f_masterAmount','f_companyShare','f_fixedMaster','f_showPhoneToMaster','f_closeDate','saveNew','clearForm','saveOrderBtn','formFinancePreview'])elements.set('#'+id,node());
 elements.get('#f_status').options=statuses.map(value=>({value,disabled:false}));
 elements.get('#f_status').querySelectorAll=()=>elements.get('#f_status').options;
 elements.set('#orderModal',{classList:{contains:()=>true}});
 const controls=[...elements.values()].filter(e=>'disabled' in e);
 const all=s=>s==='[data-status]'?buttons:s==='[data-status="Выполнен"]'?buttons.filter(x=>x.dataset.status==='Выполнен'):s.startsWith('#orderForm ')?controls:[];
 // A single-element selector deliberately returns a non-iterable node, as the browser does.
 const $=s=>elements.get(s)||all(s)[0]||null;
 const m={money:role==='owner',create:role!=='master',edit:role!=='master'};
 vm.runInNewContext(source+';applyOrderFormPermissions()',{$,$$:all,currentRole:()=>role,roleMeta:()=>m,ownerPreviewActive:()=>false,state:{orders:[],editing:null},isReviewWorkflow:()=>true});
 assert.equal(elements.get('#saveOrderBtn').hidden,!m.edit);
 assert.equal(elements.get('#saveNew').hidden,!m.create);
 assert.equal(buttons.at(-1).disabled,page==='master'||role!=='dispatcher_logistic');
 if(role==='master')assert.ok(controls.every(x=>x.disabled));
 if(role==='dispatcher')assert.equal(elements.get('#f_master').disabled,true);
});
