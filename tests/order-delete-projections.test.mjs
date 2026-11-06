import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

for(const role of ['owner','dispatcher']) test(`${role}: deleting an order atomically removes every order projection`,async()=>{
 const source=fs.readFileSync(new URL(`../src/crm/integrations/${role}.js`,import.meta.url),'utf8');
 const helper=source.split('\n').find(l=>l.includes('async function deleteOrderDocuments('));
 assert.ok(helper);
 const removed=[];let commits=0;
 const context={db:{},fs:{writeBatch:()=>({delete:r=>removed.push(r),commit:async()=>commits++})}};
 for(const [fn,col] of Object.entries({orderDoc:'orders',dispatchDoc:'dispatcherOrders',masterDoc:'masterAssignments',phoneDoc:'masterPhones',closeDataDoc:'orderCloseData'}))context[fn]=id=>col+'/'+id;
 vm.createContext(context);vm.runInContext(helper,context);await vm.runInContext("deleteOrderDocuments('TEST')",context);
 assert.deepEqual(removed,['orders/TEST','dispatcherOrders/TEST','masterAssignments/TEST','masterPhones/TEST','orderCloseData/TEST']);
 assert.equal(commits,1);
 assert.ok(!source.includes('fs.deleteDoc(orderDoc(id))'),'All deletion paths use the complete helper');
 assert.ok(source.includes('stripUndefined(orderCloseSafe(r)),{merge:cloud.versions.has(id)}'),'New staff orders replace orphans; existing orders retain server-calculated amounts');
});

test('an out-of-order close-data snapshot cannot attach the deleted generation to a reused ID',()=>{
 const source=fs.readFileSync(new URL('../src/crm/bootstrap/owner-dispatcher.js',import.meta.url),'utf8').split('\n')[0];
 const context={window:{},dispatcherCloseRows:[{orderId:'TEST',total:'10000',companyShare:'4000',_updatedAt:'2026-11-06T10:00:00Z'}]};
 vm.createContext(context);vm.runInContext(source,context);
 const newer={orderId:'TEST',_createdAt:'2026-11-06T11:00:00Z',name:'new'};
 assert.equal(context.window.MasterAIWithCloseData([newer])[0].total,undefined);
 context.dispatcherCloseRows[0]._updatedAt='2026-11-06T11:01:00Z';
 assert.equal(context.window.MasterAIWithCloseData([newer])[0].companyShare,'4000','Current generation prepared finance remains available');
});

for(const role of ['owner','dispatcher']) test(`${role}: recreating a deleted ID permits its next deletion`,async()=>{
 const source=fs.readFileSync(new URL(`../src/crm/integrations/${role}.js`,import.meta.url),'utf8');
 const upsert=source.split('\n').find(l=>l.includes('async function upsertOne('));
 let commits=0;const cloud={versions:new Map(),appliedDeleteIds:new Set(['TEST'])};
 const context={window:{},cloud,db:{},fs:{writeBatch:()=>({set:()=>{},commit:async()=>{commits++}})},orderDoc:id=>id,closeDataDoc:id=>id,stripUndefined:x=>x,orderCloseSafe:r=>r,mirrorOrder:async()=>{}};
 vm.createContext(context);vm.runInContext(upsert,context);
 await vm.runInContext("upsertOne({orderId:'TEST'},'owner')",context);
 assert.equal(commits,1);assert.equal(cloud.appliedDeleteIds.has('TEST'),false);
 assert.deepEqual(['TEST'].filter(id=>!cloud.appliedDeleteIds.has(id)),['TEST']);
});
