import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

for(const role of ['index','master','dispatcher-logistic'])test(`${role}: filter catalog canonicalizes distinct names once with unchanged choices`,()=>{
 const html=fs.readFileSync(new URL(`../hosted-snapshot/${role}.html`,import.meta.url),'utf8');
 const code=html.slice(html.indexOf('const catalog=',html.indexOf('function refillFilters()')),html.indexOf(';const fills=',html.indexOf('function refillFilters()')));
 const orders=Array.from({length:1500},(_,i)=>({dispatcher:[' Сергей ','Сергей','СЕРГЕЙ','Артём',''][i%5],master:[' Иван ','Иван','ИВАН','Пётр',''][i%5]}));
 const original=JSON.stringify(orders),clean=x=>String(x??'').trim(),key=x=>clean(x).toLowerCase();let calls=0;
 const canonical=x=>{calls++;return ({сергей:'Сергей',артём:'Артём',иван:'Иван',пётр:'Пётр'})[key(x)]||x};
 const catalog=vm.runInNewContext(code+';catalog',{state:{orders},clean,canonicalKey:key,canonicalMasterSelection:canonical,canonicalDispatcherSelection:canonical});
 for(const field of ['dispatcher','master']){
  const preset=field==='dispatcher'?['Сергей','Анна']:['Иван','Олег'];
  const seen=new Map();for(const v of [...preset,...orders.map(r=>r[field])]){const raw=clean(v);if(!raw)continue;const name=canonical(raw);if(!seen.has(key(name)))seen.set(key(name),name)}
  const expected=[...seen.values()].sort((a,b)=>a.localeCompare(b,'ru'));calls=0;
  assert.deepEqual(Array.from(catalog(field,preset)),expected);
  const distinct=new Set([...preset,...orders.map(r=>r[field])].map(clean).filter(Boolean));
  assert.equal(calls,distinct.size);assert.ok(calls<10);
 }
 assert.equal(JSON.stringify(orders),original);
});
