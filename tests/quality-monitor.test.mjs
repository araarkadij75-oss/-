import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={module:{exports:{}},Date,setTimeout,clearTimeout,setInterval,clearInterval};
vm.runInNewContext(fs.readFileSync(new URL('../hosted-snapshot/quality-monitor.js',import.meta.url),'utf8'),context);
const {analyze,dateKey}=context.module.exports;
const order=(extra={})=>({orderId:'A',_status:'Выполнен',dispatcher:'Сергей',callDate:'2026-10-01',closeDate:'2026-10-24',total:10000,parts:1000,masterAmount:5000,companyShare:4000,...extra});
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
