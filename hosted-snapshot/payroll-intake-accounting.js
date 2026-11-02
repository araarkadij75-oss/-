(function(root){
 'use strict';
 const validDate=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s};
 const money=n=>Number.isSafeInteger(n)&&n>=0;
 const entitlement=cash=>Math.max(200000,Math.round(cash/10));
 function calculate({orders=[],days=[],payments=[],cutoff,snapshotDate}={}){
  if(!validDate(cutoff))throw new Error('invalid_cutoff');
  const warnings=[],groups=new Map(),people=new Map(),seenOrders=new Map(),seenPayments=new Map();
  const warn=(code,id)=>warnings.push({code,id:String(id??'')});
  const person=p=>{if(!people.has(p))people.set(p,{person:p,earnedCents:0,paidCents:0,dueCents:0,overpaidCents:0});return people.get(p)};
  const group=(p,date)=>{const key=p+'|'+date;if(!groups.has(key))groups.set(key,{person:p,date,cashCents:0,entitlementCents:200000,orderIds:[],receipts:new Map()});person(p);return groups.get(key)};
  for(const d of days){if(!d||typeof d.person!=='string'||!d.person.trim()||!validDate(d.date)){warn('invalid_day',d?.date);continue}if(d.date<=cutoff)group(d.person,d.date)}
  for(const o of orders){
   if(!o||!o.id||typeof o.person!=='string'||!o.person.trim()){warn('invalid_order',o?.id);continue}
   const id=String(o.id);if(seenOrders.has(id)){warn(JSON.stringify(seenOrders.get(id))===JSON.stringify(o)?'duplicate_order_id':'conflicting_order_id',id);continue}seenOrders.set(id,o);
   if(o.duplicateOf)continue;
   if(!validDate(o.intakeDate)){warn('missing_or_invalid_intake_date',id);continue}
   if(!o.closed||o.intakeDate>cutoff)continue;
   const undated=o.cashDate==null||o.cashDate==='';
   if(undated){warn('missingcashdate',id);const observed=o.observedAt||snapshotDate;if(!validDate(observed)||observed>cutoff)continue}
   else if(!validDate(o.cashDate)){warn('missing_or_invalid_cash_date',id);continue}
   if(!undated&&o.cashDate<o.intakeDate){warn('cash_before_intake',id);continue}
   if(!money(o.cashCents)){warn('invalid_cash',id);continue}
   if(o.cashDate>cutoff||o.cashCents===0)continue;
   const g=group(o.person,o.intakeDate);if(!Number.isSafeInteger(g.cashCents+o.cashCents)){warn('cash_overflow',id);continue}
   g.cashCents+=o.cashCents;g.orderIds.push(id);g.receipts.set(undated?'':o.cashDate,(g.receipts.get(undated?'':o.cashDate)||0)+o.cashCents);
  }
  for(const p of payments){
   if(!p||!p.id||typeof p.person!=='string'||!p.person.trim()||!validDate(p.date)||!money(p.amountCents)){warn('invalid_payment',p?.id);continue}
   const id=String(p.id);if(seenPayments.has(id)){warn(JSON.stringify(seenPayments.get(id))===JSON.stringify(p)?'duplicate_payment_id':'conflicting_payment_id',id);continue}seenPayments.set(id,p);
   if(p.date>cutoff)continue;const target=person(p.person);if(!Number.isSafeInteger(target.paidCents+p.amountCents)){warn('payment_overflow',id);continue}target.paidCents+=p.amountCents;
  }
  const events=[],resultDays=[];
  for(const g of [...groups.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.person.localeCompare(b.person))){
   let cumulative=0,previous=200000;events.push({person:g.person,intakeDate:g.date,date:g.date,amountCents:200000,kind:'daily_minimum'});
   for(const [date,cash] of [...g.receipts].sort((a,b)=>(a[0]||'9999').localeCompare(b[0]||'9999'))){cumulative+=cash;const next=entitlement(cumulative),increase=next-previous;if(increase>0)events.push({person:g.person,intakeDate:g.date,date,amountCents:increase,kind:date?'cash_increment':'undated_increment'});previous=next}
   g.entitlementCents=entitlement(g.cashCents);person(g.person).earnedCents+=g.entitlementCents;resultDays.push({person:g.person,date:g.date,cashCents:g.cashCents,entitlementCents:g.entitlementCents,orderIds:g.orderIds.sort()});
  }
  const totals=[...people.values()].sort((a,b)=>a.person.localeCompare(b.person));for(const p of totals){p.dueCents=Math.max(0,p.earnedCents-p.paidCents);p.overpaidCents=Math.max(0,p.paidCents-p.earnedCents)}
  return {cutoff,days:resultDays,people:totals,events:events.sort((a,b)=>a.date.localeCompare(b.date)||a.person.localeCompare(b.person)||a.intakeDate.localeCompare(b.intakeDate)),warnings,incomplete:warnings.some(w=>!w.code.startsWith('duplicate_'))};
 }
 root.PayrollIntakeAccounting={calculate};
})(typeof window!=='undefined'?window:globalThis);
