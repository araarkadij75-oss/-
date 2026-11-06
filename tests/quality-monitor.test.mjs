import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class FixedDate extends Date {constructor(...args){super(...(args.length?args:['2026-11-06T12:00:00Z']))}static now(){return Date.parse('2026-11-06T12:00:00Z')}}
const context={module:{exports:{}},Date:FixedDate,setTimeout,clearTimeout,setInterval,clearInterval};
vm.runInNewContext(fs.readFileSync(new URL('../hosted-snapshot/quality-monitor.js',import.meta.url),'utf8'),context);
const {analyze,dateKey}=context.module.exports;
const order=(extra={})=>({orderId:'A',_status:'Выполнен',dispatcher:'Сергей',callDate:'2026-10-23',closeDate:'2026-10-24',total:10000,parts:1000,masterAmount:5000,companyShare:4000,...extra});
const report=(extra={})=>({id:'report',date:'2026-10-24',shift:'sergey',ownerConfirmed:true,subjectMemberId:'s',paidOrderIds:['A'],...extra});
test('validator is read-only and reevaluates current snapshots, not fixed demo numbers',()=>{
 const snapshot={orders:[order()],shiftReports:[report()]},before=JSON.stringify(snapshot);
 assert.equal(analyze(snapshot).issues.length,0);assert.equal(JSON.stringify(snapshot),before);
 snapshot.orders[0].companyShare=5000;assert.ok(analyze(snapshot).issues.some(x=>x.code==='finance_mismatch'));
 snapshot.orders[0].companyShare=4000;assert.equal(analyze(snapshot).issues.length,0);
});
test('date validation rejects impossible calendar dates, allows partial surrender with intake year',()=>{
 assert.equal(dateKey('31.02.2026'),'');assert.equal(dateKey('29.02.2024'),'2024-02-29');
 assert.equal(analyze({orders:[order({closeDate:'24.10'})]}).issues.length,0);
 assert.ok(analyze({orders:[order({visitDate:'2026-02-31'})]}).issues.some(x=>x.code==='invalid_visitDate'));
});
test('numeric Excel dates match CRM imports and fractional serials use the day',()=>{
 const expected=new Date(Date.UTC(1899,11,30)+46326*86400000).toISOString().slice(0,10);
 assert.equal(dateKey(46326),expected);assert.equal(dateKey(46326.75),expected);
 assert.equal(analyze({orders:[order({closeDate:46326})]}).issues.length,0);
 assert.equal(dateKey('46326'),'');assert.equal(dateKey(90000),'');
});
test('closed orders need a cash date and responsible dispatcher; active fields are separate',()=>{
 const issues=analyze({orders:[order({closeDate:'',dispatcher:''})]}).issues;
 assert.ok(issues.some(x=>x.code==='closed_date'));assert.ok(issues.some(x=>x.code==='closed_dispatcher'));
 const active=analyze({orders:[order({_status:'В работе',name:'',phone:'',request:'',visitDate:''})]}).issues;
 assert.ok(active.some(x=>x.code==='active_required'));assert.ok(!active.some(x=>x.code==='closed_date'));
});
test('superseded reports are not duplicate payments; different days accounting same ID are flagged',()=>{
 const old=report({id:'old',closedAt:'2026-10-24T10:00:00Z'}),current=report({closedAt:'2026-10-24T11:00:00Z'});
 assert.equal(analyze({orders:[order()],shiftReports:[old,current]}).issues.length,0);
 assert.ok(analyze({orders:[order()],shiftReports:[current,report({id:'other',date:'2026-10-25'})]}).issues.some(x=>x.code==='paid_duplicate'));
});
test('recipient changes are flagged without transferring or recalculating confirmed money',()=>{
 const saved=report({shift:'artem',salary:2000});const result=analyze({orders:[order()],shiftReports:[saved]});
 assert.ok(result.issues.some(x=>x.code==='paid_owner_conflict'));assert.equal(saved.salary,2000);
 assert.equal(analyze({orders:[order({dispatcher:'  СЕРГЕЙ '})],shiftReports:[report()]}).issues.length,0);
});
test('master projection never generates missing-private-fields or payroll issues',()=>{
 const result=analyze({orders:[order({dispatcher:'',closeDate:'',companyShare:99999})],shiftReports:[report({shift:'artem'})]},{role:'master'});
 assert.equal(result.issues.length,0);
});
test('incomplete and draft reports do not reserve orders and missing IDs remain visible',()=>{
 assert.equal(analyze({orders:[order()],shiftReports:[report({draft:true,shift:'artem'})]}).issues.length,0);
 assert.ok(analyze({orders:[],shiftReports:[report()]}).issues.some(x=>x.code==='paid_order_missing'));
});
test('zero cash is explicit, empty cash is missing; future visits are valid',()=>{
 const zero=analyze({orders:[order({total:0,parts:0,masterAmount:0,companyShare:0,visitDate:'2030-01-01'})]});
 assert.equal(zero.issues.length,0);
 assert.ok(analyze({orders:[order({companyShare:''})]}).issues.some(x=>x.code==='closed_cash'));
});
test('active omissions remain ahead of historical date issues',()=>{
 const history=Array.from({length:120},(_,i)=>order({orderId:'old'+i,closeDate:''}));
 const active=order({orderId:'new',_status:'В работе',master:'',request:'',visitDate:'2026-11-02'});
 const result=analyze({orders:[...history,active]});
 assert.equal(result.issues[0].orderId,'new');assert.ok(result.issues.some(x=>x.code==='active_master'));
});
test('unchanged checks preserve panel focus and destroy removes periodic listeners',()=>{
 const events=new Map(),doc={hidden:false,addEventListener:(k,f)=>events.set(k,f),removeEventListener:k=>events.delete(k)};
 doc.defaultView={addEventListener:(k,f)=>events.set(k,f),removeEventListener:k=>events.delete(k)};
 doc.createElement=()=>({ownerDocument:doc,dataset:{},children:[],setAttribute(){},addEventListener(){},append(...xs){this.children.push(...xs)},replaceChildren(...xs){this.children=xs;this.replacements=(this.replacements||0)+1},remove(){this.removed=true}});
 const panel=doc.createElement(),badgeHost=doc.createElement(),snapshot={orders:[order()],shiftReports:[]};
 const monitor=context.module.exports.create({getSnapshot:()=>snapshot,panel,badgeHost,role:'owner'});
 try{monitor.refresh(true);const first=panel.children[0],count=panel.replacements;monitor.refresh(true);assert.equal(panel.children[0],first);assert.equal(panel.replacements,count);snapshot.orders[0].companyShare=99;monitor.refresh(true);assert.ok(panel.replacements>count);assert.ok(events.has('focus'));const select=panel.children.find(x=>x.className==='select quality-monitor-filter');select.value='finance';select.onchange();assert.equal(panel.children.find(x=>x.className==='select quality-monitor-filter').value,'finance');doc.defaultView.navigator={onLine:false};monitor.refresh(true);assert.equal(monitor.getResult().connected,false)}finally{monitor.destroy()}
 assert.equal(events.size,0);assert.equal(badgeHost.children[0].removed,true);
});

test('server failure is visible and monitor cleanup clears the panel',async()=>{
 const doc={hidden:false,addEventListener(){},removeEventListener(){},defaultView:{addEventListener(){},removeEventListener(){}}};
 doc.createElement=()=>({ownerDocument:doc,dataset:{},children:[],setAttribute(){},addEventListener(){},append(...xs){this.children.push(...xs)},replaceChildren(...xs){this.children=xs},remove(){}});
 const panel=doc.createElement();let reject;
 const monitor=context.module.exports.create({getSnapshot:()=>({orders:[]}),getServerStatus:()=>new Promise((_,r)=>{reject=r}),panel,role:'owner'});
 monitor.refresh(true);reject(new Error('offline'));await new Promise(r=>setImmediate(r));
 assert.match(panel.children.find(x=>x.className==='quality-server-status').textContent,/недоступна/);
 monitor.destroy();assert.equal(panel.children.length,0);
});


test('linked duplicate retains a manual saved-payroll warning without operational noise',()=>{const duplicate=order({orderId:'B',_duplicateOf:'A',phone:'',name:''});const result=analyze({orders:[order(),duplicate],shiftReports:[{id:'r',date:'2026-10-24',shift:'sergey',ownerConfirmed:true,subjectMemberId:'s',paidOrderIds:['A','B']}]});assert.ok(result.issues.some(x=>x.code==='paid_linked_duplicate'));assert.ok(!result.issues.some(x=>x.code==='duplicate_link_invalid'));const bad=analyze({orders:[duplicate]});assert.ok(bad.issues.some(x=>x.code==='duplicate_link_invalid'))});

test('missing surrender date remains visible but does not claim saved payroll is unassigned',()=>{const r=analyze({orders:[order({closeDate:''})],shiftReports:[{id:'s',date:'2026-10-24',shift:'sergey',ownerConfirmed:true,subjectMemberId:'s',paidOrderIds:['A']}]});const issue=r.issues.find(x=>x.code==='closed_date');assert.equal(issue.severity,'warning');assert.match(issue.message,/уже учтена/)});
test('quality scope covers the latest 15 Moscow calendar days without changing historical orders or payroll references',()=>{
 const old=order({orderId:'OLD',callDate:'2026-09-30',closeDate:'',dispatcher:'',companyShare:''});
 const current=order({orderId:'NEW',callDate:'2026-10-23',closeDate:''});
 const unknown=order({orderId:'UNKNOWN',callDate:'',closeDate:'',visitDate:''});
 const reports=[report({date:'2026-09-30',paidOrderIds:['OLD','MISSING_OLD']}),report({id:'new',paidOrderIds:['NEW']})];
 const snapshot={orders:[old,current,unknown],shiftReports:reports},before=JSON.stringify(snapshot);
 const result=analyze(snapshot);assert.equal(result.scopeStart,'2026-10-23');assert.equal(result.orderCount,2);assert.equal(result.totalOrderCount,3);
 assert.ok(!result.issues.some(x=>['OLD','MISSING_OLD'].includes(x.orderId)));
 assert.ok(result.issues.some(x=>x.orderId==='NEW'));assert.ok(result.issues.some(x=>x.orderId==='UNKNOWN'));
 assert.equal(JSON.stringify(snapshot),before);
});
test('cancelled and refused orders never require a master assignment',()=>{
 for(const status of ['Отмена','Отказ']){
  const result=analyze({orders:[order({_status:status,master:'',name:'',phone:'',request:'',visitDate:'',total:0,masterAmount:0,companyShare:0,parts:0})]});
  assert.ok(!result.issues.some(x=>x.code==='active_master'||x.code==='active_required'));
 }
});

 test("quality module import and service worker share the scope-aware cache key",()=>{for(const file of ["src/crm/bootstrap/shared.js","hosted-snapshot/sw.js"]){const source=fs.readFileSync(file,"utf8");assert.ok(source.includes("quality-monitor.js?v=20261106-quality5"));assert.ok(!source.includes("20261101-quality2"));}});

test('rolling scope advances at Moscow midnight, retains boundary, future and unknown dates',()=>{
 const rows=[order({orderId:'old',callDate:'2026-10-22'}),order({orderId:'boundary',callDate:'2026-10-23'}),order({orderId:'future',callDate:'2027-01-01'}),order({orderId:'unknown',callDate:'',visitDate:''})];
 const first=analyze({orders:rows},{now:'2026-11-06T20:59:59Z'}),next=analyze({orders:rows},{now:'2026-11-06T21:00:00Z'});
 assert.equal(first.scopeStart,'2026-10-23');assert.equal(first.orderCount,3);
 assert.equal(next.scopeStart,'2026-10-24');assert.equal(next.orderCount,2);
 assert.equal(context.module.exports.scopeStartAt('2027-01-01T00:00:00Z'),'2026-12-18');
});

test('dispatchers see only their accepted operational issues and never private finance or payroll fields',()=>{
 const api=context.module.exports,sergey={id:'s',uid:'uid-s',role:'dispatcher_logistic',name:'Сергей',shift:'sergey'},artem={id:'a',uid:'uid-a',role:'dispatcher_logistic',name:'Артём',shift:'artem'};
 const active=(id,dispatcher,extra={})=>order({orderId:id,dispatcher,_status:'В работе',master:'',name:'',phone:'',request:'',visitDate:'',...extra});
 const snapshot={orders:[active('S','Сергей'),active('A','Артём'),active('U','',{_createdByName:'Владелец',_createdByShift:'sergey'}),active('CREATOR','',{_createdByName:'Сергей'}),active('EXPLICIT','Иван',{_createdByName:'Сергей'}),active('OLD','Сергей',{callDate:'2026-10-22'}),order({orderId:'MONEY',companyShare:9999999,closeDate:'',_closeApprovedBy:'owner'})],shiftReports:[report({salary:9999999})]},before=JSON.stringify(snapshot);
 const s=api.analyze(snapshot,{role:'dispatcher_logistic',actor:sergey}),a=api.analyze(snapshot,{role:'dispatcher_logistic',actor:artem});
 assert.deepEqual([...new Set(s.issues.map(x=>x.orderId))].sort(),['CREATOR','S']);assert.deepEqual([...new Set(a.issues.map(x=>x.orderId))],['A']);assert.ok(s.issues.every(x=>x.responsibleName==='Сергей'));assert.ok(a.issues.every(x=>x.responsibleName==='Артём'));
 assert.ok(s.issues.every(x=>/^active_|^invalid_(callDate|visitDate)$/.test(x.code)));const safe=api.projectStaffSnapshot(snapshot,sergey);assert.equal(safe.shiftReports.length,0);for(const r of safe.orders)for(const key of ['companyShare','masterAmount','parts','total','salary','closeDate','_cashClosedAt','_closeApprovedBy'])assert.ok(!(key in r),key+' must not enter the staff monitor');assert.equal(JSON.stringify(snapshot),before);
 assert.equal(api.staffPerson({...sergey,role:'dispatcher'}),'sergey');assert.equal(api.staffPerson({...artem,role:'logistic'}),'artem');assert.equal(api.analyze(snapshot,{role:'dispatcher_logistic'}).issues.length,0);assert.equal(api.analyze(snapshot,{role:'dispatcher_logistic',actor:{...sergey,role:'owner'}}).issues.length,0);assert.equal(api.analyze(snapshot,{role:'dispatcher_logistic',actor:{...sergey,shift:'artem'}}).issues.length,0);
});

test('staff quality UI has own responsibility and open-order actions without finance/payroll categories',()=>{
 const doc={hidden:false,addEventListener(){},removeEventListener(){},defaultView:{addEventListener(){},removeEventListener(){}}};doc.createElement=()=>({ownerDocument:doc,dataset:{},children:[],setAttribute(){},addEventListener(){},append(...xs){this.children.push(...xs)},replaceChildren(...xs){this.children=xs},remove(){}});
 const panel=doc.createElement(),badgeHost=doc.createElement(),actor={id:'s',role:'dispatcher_logistic',name:'Сергей',shift:'sergey'},snapshot={orders:[order({_status:'В работе',master:'',name:'',phone:'',request:'',visitDate:''})]},opened=[];
 const monitor=context.module.exports.create({panel,badgeHost,role:'dispatcher_logistic',actor:()=>actor,getSnapshot:()=>snapshot,openOrder:id=>opened.push(id)});
 try{monitor.refresh(true);assert.equal(panel.children[0].textContent,'Мои замечания за 15 дней');const select=panel.children.find(x=>x.className==='select quality-monitor-filter');assert.deepEqual(select.children.map(x=>x.value),['all','active','dates']);const list=panel.children.find(x=>x.className==='quality-monitor-list');assert.ok(list.children.every(li=>li.children.some(x=>x.textContent==='Ответственный: Сергей')));list.children[0].children.find(x=>x.textContent==='Открыть заказ A').onclick();assert.deepEqual(opened,['A']);Object.assign(snapshot.orders[0],{master:'Мастер',name:'Клиент',phone:'123',request:'Работа',visitDate:'2026-11-06'});monitor.refresh(true);assert.equal(monitor.getResult().issues.length,0);}finally{monitor.destroy()}
});

test('dispatcher integration uses authenticated identity, strips amounts and rechecks ownership on opening',()=>{
 const text=fs.readFileSync(new URL('../src/crm/quality/shared.js',import.meta.url),'utf8'),code=text.split('/* CRM_UNIT:refreshLiveQuality-e2fb0d2da0de */')[1].split('/* CRM_END:refreshLiveQuality-e2fb0d2da0de */')[0];let options,destroyed=0,preview=false;const opened=[],nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id)};
 const cloud={connected:true,profile:{id:'s',uid:'uid-s',role:'dispatcher_logistic',name:'Сергей',shift:'sergey'}},state={session:{user:{id:'s',role:'dispatcher_logistic'}},orders:[order({orderId:'S',_status:'В работе'}),order({orderId:'A',dispatcher:'Артём',_status:'В работе'})],shiftReports:[report()]};const api={...context.module.exports,create:opts=>{options=opts;return{refresh(){},destroy(){destroyed++}}}};
 const ctx={state,window:{MasterAICloud:cloud,MasterAIQualityMonitor:api},navigator:{onLine:true},$,ownerPreviewActive:()=>preview,openOrder:r=>opened.push(r.orderId),switchTab(){},liveQualityMonitor:null};vm.createContext(ctx);vm.runInContext(code+';globalThis.run=refreshLiveQuality',ctx);ctx.run();assert.equal(options.getServerStatus,undefined);assert.ok(options.getSnapshot().orders.every(r=>r.orderId==='S'&&!('companyShare' in r)));options.openOrder('A');options.openOrder('S');assert.deepEqual(opened,['S']);state.orders[0].dispatcher='Артём';options.openOrder('S');assert.deepEqual(opened,['S']);
 const stale=options;cloud.profile={id:'a',uid:'uid-a',role:'dispatcher_logistic',name:'Артём',shift:'artem'};state.session.user={id:'a',role:'dispatcher_logistic'};assert.equal(stale.getSnapshot().orders.length,0);stale.openOrder('A');assert.deepEqual(opened,['S']);ctx.run();assert.equal(destroyed,1);assert.ok(options.getSnapshot().orders.every(r=>r.dispatcher==='Артём'));
 cloud.profile={id:'owner',uid:'uid-owner',role:'owner'};state.session.user={id:'owner',role:'owner'};preview=true;ctx.run();assert.equal(destroyed,2);assert.equal($('#myQualityPanel').hidden,true);
});
