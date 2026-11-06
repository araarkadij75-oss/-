import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = role => fs.readFileSync(new URL(`../src/crm/integrations/${role}.js`, import.meta.url), 'utf8');
for (const role of ['owner','dispatcher']) test(`${role} adapter: private finance is calculated before closing and never overwritten by empty inputs`, async () => {
  const source = read(role);
  const lines = source.split('\n');
  const declarations = ['opsOrderSafe','orderCloseSafe','operationalOrderFields','operationalCreateFields'].flatMap(name => {
    const line = lines.find(l => l.includes(`const ${name}=`));
    return line ? [line] : [];
  });
  const upsert = lines.find(l => l.includes('async function upsertOne('));
  const events = [], writes = [];
  const context = {
    cloud:{profile:{id:'sergey',name:'Сергей'},versions:new Map([['TEST','old']]),getIdToken:async()=> 'private-test-token'},
    fetch:async(url,request)=>{events.push('calculate'); const body=JSON.parse(request.body);assert.equal(body.op,'order_calculate');assert.equal(body.expectedUpdatedAt,'old');assert.equal(body.total,'10000');return {ok:true,json:async()=>({ok:true})}},
    fs:{writeBatch:()=>({set:(path,data)=>writes.push({path,data}),commit:async()=>events.push('commit')})},db:{},
    orderDoc:id=>'orders/'+id,closeDataDoc:id=>'close/'+id,
    stripUndefined:o=>Object.fromEntries(Object.entries(o).filter(([,v])=>v!==undefined)),
    mirrorOrder:async()=>{},window:{},
    operationalOrderFields:()=>['total','parts','cleanCheck','masterAmount','companyShare','_status'],
    operationalCreateFields:()=>[],
    row:{orderId:'TEST',total:'10000',parts:'2000',cleanCheck:'',masterAmount:'',companyShare:'',_status:'Выполнен',master:'Николай',_updatedAt:'new',closeDate:'06.11.2026'},
  };
  vm.createContext(context);
  vm.runInContext(declarations.join('\n')+'\n'+upsert,context);
  await vm.runInContext("upsertOne(row,'dispatcher_logistic')",context);
  assert.deepEqual(events,['calculate','commit']);
  for(const {data} of writes) for(const key of ['total','parts','cleanCheck','masterAmount','companyShare']) assert.ok(!(key in data),`${key} must remain server-owned on staff writes`);
  events.length=0;writes.length=0;
  context.fetch=async()=>({ok:false,json:async()=>({ok:false,error:'manual_finance_owner_required'})});
  await assert.rejects(vm.runInContext("upsertOne(row,'dispatcher_logistic')",context),/владелец/);
  assert.equal(writes.length,0,'A rejected financial input cannot close the order');
});

for (const role of ['owner','dispatcher']) test(`${role}: saving a closed order preserves the first closing audit and date`, () => {
  const source=fs.readFileSync(new URL(`../src/crm/orders/${role}.js`,import.meta.url),'utf8');
  const body=source.match(/stampLogisticsClose=\(\)=>\{(.*?)\};if\(idx>=0\)/s)?.[1];
  assert.ok(body);
  const r={closeDate:'05.11.2026',_closeApprovedAt:'first',_closeApprovedBy:'original',_closeApprovedByName:'Сергей',_doneAt:'first',_cashClosedAt:'first',_cashClosedOn:'2026-11-05',_cashClosedBy:'original',_cashClosedByName:'Сергей'};
  const context={r,currentUser:()=>({id:'other',name:'Другой'}),today:()=> '2026-11-06',ddmm:()=> '06.11.2026'};
  vm.runInNewContext(body,context);
  for(const key of ['_closeApprovedAt','_doneAt','_cashClosedAt']) assert.equal(r[key],'first');
  assert.equal(r._closeApprovedBy,'original');
  assert.equal(r.closeDate,'05.11.2026');
  assert.equal(r._cashClosedOn,'2026-11-05');
});
