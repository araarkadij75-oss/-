import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
for(const page of ['index','dispatcher-logistic','master'])test(`${page}: personal login remains editable and visible after reopening`,()=>{
 const html=fs.readFileSync(new URL(`../hosted-snapshot/${page}.html`,import.meta.url),'utf8');
 const source=html.match(/^function renderLoginUsers\(\).*$/m)[0];
 const role=page==='index'?'owner':page==='master'?'master':'dispatcher_logistic';
 const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',readOnly:true,hidden:true});return nodes.get(id)};
 const context={$,cloudMode:()=>true,FORCED_APP_ROLE:role};
 vm.runInNewContext(source+';renderLoginUsers()',context);
 assert.equal($('#cloudLoginUser').readOnly,false);
 assert.equal($('#cloudLoginUserWrap').hidden,false);
 assert.notEqual($('#cloudLoginUser').value,'beta-master');
 if(role!=='dispatcher_logistic'){
  $('#cloudLoginUser').value='personal-login';vm.runInNewContext('renderLoginUsers()',context);
  assert.equal($('#cloudLoginUser').value,'personal-login');
 }
});
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

for(const role of ['owner','dispatcher','master'])test(`${role}: editing preserves source audit provenance without copying arbitrary privileged fields`,()=>{
 const file=fs.readFileSync(new URL(`../src/crm/orders/${role}.js`,import.meta.url),'utf8');
 const source=file.match(/^function formRecord\(\).*$/m)[0];
 const audit={auditId:'audit-original',sourceRow:1876,sourceSpreadsheet:'source-sheet',appliedAt:'2026-11-01T16:21:39Z',actorUid:'original-actor'};
 const original={_id:'order-1',orderId:'261101-007',_sourceReconciliation:{...audit,grantOwner:true},_createdAt:'2026-11-01T12:00:00Z',_createdBy:'dispatcher-id',_createdByName:'Сергей',_origin:'excel',_grantOwner:true};
 const before=JSON.stringify(original),fields={f_id:'order-1',f_total:'9500',f_sourceReconciliation:'forged-audit'};
 const ctx={state:{orders:[original],schemeTouched:false},$:s=>({value:fields[s.slice(1)]||'',checked:false}),clean:x=>String(x??'').trim(),uid:()=> 'new-id',makeOrderId:()=> 'new-order',lockedDispatcher:()=> 'Сергей',masterFixedMode:()=>false,currentRole:()=> 'owner',currentUser:()=>({id:'owner',name:'Владелец',shift:''})};
 const record=vm.runInNewContext(source+';formRecord()',ctx);
 assert.deepEqual(JSON.parse(JSON.stringify(record._sourceReconciliation)),audit);
 assert.equal(record.total,'9500');
 assert.equal(record._createdBy,'dispatcher-id');
 assert.equal(record._createdAt,original._createdAt);
 assert.equal(record._origin,'excel');
 assert.equal(record._updatedBy,'owner');
 assert.equal('_grantOwner' in record,false);
 assert.equal(JSON.stringify(original),before);
 fields.f_id='';
 const created=vm.runInNewContext(source+';formRecord()',ctx);
 assert.equal('_sourceReconciliation' in created,false,'new orders must not inherit an unrelated source audit');
});

for(const role of ['owner','dispatcher','master'])test(`${role}: default dates and city cannot create an empty order`,async()=>{
 const source=fs.readFileSync(new URL(`../src/crm/orders/${role}.js`,import.meta.url),'utf8');
 const start=source.indexOf('async function saveOrder('),end=source.indexOf('if(logisticsClose)',start);
 const body=source.slice(start,role==='master'?source.indexOf('if(r._autoFinance)',start):end)+'return r;}';
 for(const value of ['', '   ']){let message='';const ctx={can:()=>true,currentRole:()=> 'owner',formRecord:()=>({name:value,phone:value,address:value,request:value,city:'СПб',callDate:'2026-11-06',visitDate:'2026-11-06'}),clean:x=>String(x??'').trim(),isMeaningful:()=>true,toast:x=>message=x};
 const result=await vm.runInNewContext(body+';saveOrder()',ctx);assert.equal(result,undefined);assert.match(message,/пустой заказ/);}
});

for(const page of ['index','dispatcher-logistic','master'])test(`${page}: staff renderer starts before authentication without owner-only helpers`,()=>{
 const html=fs.readFileSync(new URL(`../hosted-snapshot/${page}.html`,import.meta.url),'utf8');
 const render=html.match(/^function renderStaff\(\).*$/m)[0],preview=html.match(/^function ownerPreviewActive\(\).*$/m)[0];
 const nodes=new Map(),$=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',onclick:null});return nodes.get(s)};
 const ctx={$, $$:()=>[], state:{session:{},settings:{staff:[]}},currentUser:()=>({role:'owner'}),toggleNewStaffPin:()=>{}};
 vm.runInNewContext(preview+';'+render+';renderStaff()',ctx);
 assert.match($('#staffList').innerHTML,/Аккаунтов сотрудников пока нет/);
 if(page!=='index')assert.doesNotMatch(html,/\bownerRolePreview\(/);
});

// A cancelled/refused intake needs no technician; only actionable work enters assignment control.
test('form preview does not request a technician for refusal or cancellation',()=>{
 const source=fs.readFileSync(new URL('../src/crm/orders/shared.js',import.meta.url),'utf8').match(/^function renderFormPreview\(.*$/m)[0];
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{checked:false,innerHTML:'',value:''});return nodes.get(id)};
 const record={name:'Test',phone:'',address:'Test',dispatcher:'Test',request:'Test',visitDate:'2026-11-06',master:'',_autoFinance:false};
 const ctx={$,formRecord:()=>record,calcAuto:()=>({base:0}),numMaybe:()=>null,money:String,pct:String,esc:String,statusPill:()=>'',currentRole:()=> 'owner',clean:v=>String(v||''),cleanPhoneForCompare:()=>'',state:{orders:[]},parseDate:()=>null,num:v=>Number(v)||0,invalidMoney:()=>false};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 for(const status of ['Отказ','Отмена']){record._status=status;ctx.renderFormPreview();assert.doesNotMatch($('#formChecks').innerHTML,/Мастер пока не назначен/)}
 for(const status of ['В работе','Забор / техника у мастера','Будущая дата']){record._status=status;ctx.renderFormPreview();assert.match($('#formChecks').innerHTML,/Мастер пока не назначен/)}
});

test('shift assignment control excludes terminal orders in current and legacy snapshots',()=>{
 const rows=['Отмена','Отказ','Выполнен','В работе','Будущая дата'].map((status,i)=>({orderId:String(i),_status:status,master:'',total:0,companyShare:0}));
 for(const [file,name] of [['owner-dispatcher','shiftSnapshot'],['owner-dispatcher','legacyShiftSnapshot'],['master','shiftSnapshot']]){
  const source=fs.readFileSync(new URL('../src/crm/payroll/'+file+'.js',import.meta.url),'utf8').match(new RegExp('^function '+name+'\\(.*$','m'))[0];
  const ctx={state:{orders:rows,settings:{}},shiftOrders:()=>rows,num:v=>Number(v)||0,derivedStage:r=>r._status,truthReview:()=>false,sum:(rs,fn)=>rs.reduce((n,r)=>n+fn(r),0),pinHash:String,shiftName:String,isServiceMaster:v=>!v,shiftPayroll:()=>0,payrollIntakeSnapshot:()=>({days:[]}),payrollShiftKey:()=> 'sergey',today:()=> '2026-11-06',isPickupOrder:()=>false,orderMatchesDispatcher:()=>true};
  vm.createContext(ctx);vm.runInContext(source,ctx);const result=ctx[name]('2026-11-06',{id:'sergey',shift:'sergey',name:'Сергей'});
  assert.equal(result.unassigned,2,file+'/'+name);assert.equal(result.cancelled,1);assert.equal(result.refused,1);
 }
});
