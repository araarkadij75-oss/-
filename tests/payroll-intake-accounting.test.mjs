import test from 'node:test';import assert from 'node:assert/strict';import '../hosted-snapshot/payroll-intake-accounting.js';
const calculate=globalThis.PayrollIntakeAccounting.calculate;
const o=(id,intakeDate,cashDate,cashCents,extra={})=>({id,person:'sergey',intakeDate,cashDate,cashCents,closed:true,...extra});
const d=date=>({person:'sergey',date});
const p=(id,date,amountCents)=>({id,date,person:'sergey',amountCents});

test('partial settlement retains unpaid dated receipts before reconciliation and omitted days',()=>{
 const orders=[o('a','2026-10-21','2026-10-22',2924500),o('b','2026-10-21','2026-10-24',1100000),o('c','2026-10-30','2026-11-02',2837000)];
 const snapshot=calculate({orders,cutoff:'2026-11-06',payments:[p('credit','2026-11-03',292450)]});
 snapshot.orders=orders;snapshot.baselines=[{person:'sergey',date:'2026-11-03',days:[{date:'2026-10-21',cashCents:2924500}]}];snapshot.payments=[];
 const r=globalThis.PayrollIntakeAccounting.settlementSequence(snapshot,{anchor:'2026-10-21',first:'sergey'});
 assert.equal(r.unallocated.length,0);assert.equal(r.cycles.at(-1).dueCents,393700);
 assert.ok(r.cycles.flatMap(c=>c.events).some(e=>e.date==='2026-10-24'&&e.amountCents===110000));
});

test('two-day payment sequence carries partner-day late increments into next own cycle',()=>{
 const orders=[o('old','2026-10-31','2026-11-03',2500000),o('new','2026-11-04','2026-11-04',2500000)];
 const snapshot=calculate({cutoff:'2026-11-05',days:[d('2026-10-31'),d('2026-11-04'),d('2026-11-05')],orders});
 snapshot.orders=orders;snapshot.payments=[];snapshot.baselines=[{person:'sergey',date:'2026-11-01',days:[{date:'2026-10-31',cashCents:0}]}];
 const r=globalThis.PayrollIntakeAccounting.settlementSequence(snapshot,{anchor:'2026-10-31',first:'sergey'});
 assert.equal(r.cycles.length,1);assert.equal(r.cycles[0].end,'2026-11-05');assert.equal(r.cycles[0].ownCents,450000);assert.equal(r.cycles[0].lateCents,50000);assert.equal(r.cycles[0].dueCents,500000);assert.equal(r.unallocated.length,0);
});

test('unknown receipt delta stays separate; no duplicate baseline payment or invented date',()=>{
 const orders=[o('old','2026-10-31','',2800000)];
 const snapshot=calculate({cutoff:'2026-11-05',snapshotDate:'2026-11-05',orders});snapshot.orders=orders;
 snapshot.baselines=[{person:'sergey',date:'2026-11-01',days:[{date:'2026-10-31',cashCents:2500000}]}];snapshot.payments=[{...p('baseline','2026-11-01',250000),kind:'settlement_baseline'}];
 const r=globalThis.PayrollIntakeAccounting.settlementSequence(snapshot,{anchor:'2026-10-31',first:'sergey'});
 assert.equal(r.cycles.length,0);assert.equal(r.unallocated[0].amountCents,30000);assert.equal(r.unallocated[0].date,'');
});
test('each intake day keeps its own minimum: 25k and 15k cash earn 4500',()=>{const r=calculate({cutoff:'2026-10-20',days:[d('2026-10-19'),d('2026-10-20')],orders:[o('a','2026-10-19','2026-10-19',2500000),o('b','2026-10-20','2026-10-20',1500000)]});assert.equal(r.people[0].earnedCents,450000);assert.deepEqual(r.days.map(x=>x.entitlementCents),[250000,200000]);assert.equal(r.events.reduce((s,x)=>s+x.amountCents,0),450000)});
test('late closure increases original day only by marginal entitlement; paid aggregate is deducted once',()=>{const input={days:[d('2026-10-19')],orders:[o('first','2026-10-19','2026-10-19',1500000),o('late','2026-10-19','2026-10-23',1000000)],payments:[p('paid','2026-10-20',200000)]};const before=JSON.stringify(input),r=calculate({...input,cutoff:'2026-10-23'});assert.equal(r.days.length,1);assert.equal(r.days[0].date,'2026-10-19');assert.equal(r.people[0].dueCents,50000);assert.deepEqual(r.events.filter(x=>x.date==='2026-10-23').map(x=>x.amountCents),[50000]);assert.equal(JSON.stringify(input),before);assert.equal(calculate({...input,cutoff:'2026-10-20'}).people[0].dueCents,0)});
test('historical paid amounts are employee credits, not invented per-day allocations',()=>{const r=calculate({cutoff:'2026-10-23',days:[d('2026-10-19'),d('2026-10-20')],orders:[o('late','2026-10-19','2026-10-23',3000000)],payments:[p('r1','2026-10-19',450000),p('r2','2026-10-20',200000)]});assert.equal(r.people[0].earnedCents,500000);assert.equal(r.people[0].paidCents,650000);assert.equal(r.people[0].dueCents,0);assert.equal(r.people[0].overpaidCents,150000);assert.ok(r.days.every(x=>!('paidCents' in x)))});
test('duplicate IDs and linked copies never inflate receipts or payments',()=>{const a=o('a','2026-10-19','2026-10-19',2500000),payment=p('paid','2026-10-20',200000),r=calculate({cutoff:'2026-10-20',orders:[a,{...a},o('copy','2026-10-19','2026-10-19',2500000,{duplicateOf:'a'})],payments:[payment,{...payment}]});assert.equal(r.people[0].earnedCents,250000);assert.equal(r.people[0].paidCents,200000);assert.deepEqual(r.warnings.map(x=>x.code),['duplicate_order_id','duplicate_payment_id'])});
test('missing dates, invalid money and future work cannot invent payable days',()=>{const r=calculate({cutoff:'2026-10-20',orders:[o('missing','','2026-10-19',10000),o('undated','2026-10-19','',10000),o('future','2026-10-21','2026-10-21',5000000),o('zero','2026-10-19','2026-10-19',0),o('invalid','2026-10-19','2026-10-19',1.2)],days:[d('2026-10-21')]});assert.equal(r.days.length,0);assert.equal(r.people.length,0);assert.equal(r.warnings.length,3);assert.equal(r.incomplete,true);assert.throws(()=>calculate({cutoff:'2026-02-31'}),/invalid_cutoff/)});
test('zero-cash day earns minimum only when independently listed; future payment is excluded',()=>{const r=calculate({cutoff:'2026-10-20',days:[d('2026-10-19'),d('2026-10-19')],payments:[p('future','2026-10-21',300000)]});assert.equal(r.days.length,1);assert.equal(r.people[0].earnedCents,200000);assert.equal(r.people[0].paidCents,0)});
test('cents round on cumulative entitlement and increments conserve the final amount',()=>{const r=calculate({cutoff:'2026-10-21',orders:[o('a','2026-10-19','2026-10-19',2000004),o('b','2026-10-19','2026-10-20',1),o('c','2026-10-19','2026-10-21',10)]});assert.equal(r.days[0].entitlementCents,200002);assert.equal(r.events.reduce((s,x)=>s+x.amountCents,0),200002);assert.deepEqual(r.events.filter(x=>x.kind==='cash_increment').map(x=>x.amountCents),[1,1])});
test('conflicting payment IDs are explicit blockers instead of silent extra payment',()=>{const r=calculate({cutoff:'2026-10-20',payments:[p('same','2026-10-19',200000),p('same','2026-10-19',300000)]});assert.equal(r.people[0].paidCents,200000);assert.equal(r.incomplete,true);assert.equal(r.warnings[0].code,'conflicting_payment_id')});

test('confirmed undated receipts increase original entitlement without inventing receipt date',()=>{
 const r=calculate({cutoff:'2026-11-02',snapshotDate:'2026-11-02',orders:[o('dated','2026-10-19','2026-10-19',1500000),o('undated','2026-10-19','',1000000)],payments:[p('paid','2026-10-20',200000)]});
 assert.equal(r.days[0].cashCents,2500000);assert.equal(r.people[0].dueCents,50000);
 assert.deepEqual(r.events.filter(x=>x.kind==='undated_increment'),[{person:'sergey',intakeDate:'2026-10-19',date:'',amountCents:50000,kind:'undated_increment'}]);
 assert.equal(r.events.reduce((s,x)=>s+x.amountCents,0),r.people[0].earnedCents);assert.equal(r.warnings[0].code,'missingcashdate');assert.equal(r.incomplete,true);
});
test('undated receipts require observation proof at historical cutoff; explicit observedAt can provide it',()=>{
 const input={cutoff:'2026-10-20',snapshotDate:'2026-11-02',orders:[o('undated','2026-10-19','',2500000)]};
 assert.equal(calculate(input).days.length,0);
 assert.equal(calculate({...input,orders:[{...input.orders[0],observedAt:'2026-10-20'}]}).days[0].entitlementCents,250000);
 assert.equal(calculate({...input,snapshotDate:undefined}).days.length,0);
});
test('invalid receipt dates are not silently treated as confirmed undated receipts',()=>{
 const r=calculate({cutoff:'2026-11-02',snapshotDate:'2026-11-02',orders:[o('bad','2026-10-19','2026-02-31',2500000)]});assert.equal(r.days.length,0);assert.equal(r.warnings[0].code,'missing_or_invalid_cash_date');
});
