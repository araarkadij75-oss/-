import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
for(const role of ['index','master','dispatcher-logistic'])test(`${role}: import and form retain source city, owner can correct it`,()=>{
 const html=fs.readFileSync(new URL(`../hosted-snapshot/${role}.html`,import.meta.url),'utf8');
 const clean=x=>String(x??'').trim();
 const merge=html.slice(html.indexOf('for(const r of state.importRows)'),html.indexOf('for(const r of state.importRows)')+250);
 const assignment=merge.match(/r\.city=[^;]+;/)?.[0];assert.ok(assignment);
 for(const [input,want] of [['КРД','КРД'],['СПб','СПб'],['','СПб']]){const r={city:input};vm.runInNewContext(assignment,{r,clean});assert.equal(r.city,want)}
 const form=html.match(/function formRecord\(\)[^\n]+/)[0];const city=form.match(/,city:([^,]+),callDate:/)?.[1];assert.ok(city);
 assert.equal(vm.runInNewContext(city,{get:()=> 'КРД',existing:{city:'СПб'},clean}),'КРД');
 assert.equal(vm.runInNewContext(city,{get:()=> '',existing:{city:'КРД'},clean}),'КРД');
 assert.equal(vm.runInNewContext(city,{get:()=> '',existing:undefined,clean}),'СПб');
 const lock=html.match(/\$\('#f_city'\)\.readOnly=[^;]+;/)?.[0];assert.ok(lock);
 for(const role of ['owner','master','dispatcher_logistic']){const field={};vm.runInNewContext(lock,{$:()=>field,currentUser:()=>({role})});assert.equal(field.readOnly,role!=='owner')}
 assert.match(html,/k==='city'\?\(clean\(r\[k\]\)\|\|'СПб'\)/);
});
