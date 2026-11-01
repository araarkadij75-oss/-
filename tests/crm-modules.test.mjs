import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'acorn';
import { loadSources, assembleRole, dependencyContract, validateContract, repositoryRoot } from '../scripts/build-crm.mjs';
import { analyzeScript } from '../scripts/crm-module-analysis.mjs';

const context = () => loadSources();
const assemblies = c => Object.fromEntries(Object.keys(c.manifest.roles).map(role => [role,assembleRole(c,role)]));
const contract = c => JSON.parse(fs.readFileSync(path.join(c.base,'dependency-contract.json'),'utf8'));
const unitFor = (c,name) => Object.keys(c.manifest.units).find(id => c.manifest.units[id].symbols.includes(name) && c.manifest.units[id].roles.includes('owner'));

test('all three deployable role pages are deterministic compilations of the modules', () => {
  const c = context(), output = assemblies(c);
  for (const [role, result] of Object.entries(output)) assert.equal(result.html, fs.readFileSync(path.join(repositoryRoot,'hosted-snapshot',result.output),'utf8'),role);
  validateContract(contract(c), dependencyContract(c,output));
});

test('a new unresolved identifier in an existing module blocks the build contract', () => {
  const c = context(), id = unitFor(c,'money');
  c.sources.set(id,c.sources.get(id).replace('return ', 'unreviewedGlobalDependency();return '));
  assert.throws(() => validateContract(contract(c),dependencyContract(c,assemblies(c))),/New unresolved\/global reference unreviewedGlobalDependency/);
});

test('a new cross-domain call is rejected even when its function already exists', () => {
  const c = context(), id = unitFor(c,'money');
  c.sources.set(id,c.sources.get(id).replace('return ', 'closeCurrentShift();return '));
  assert.throws(() => validateContract(contract(c),dependencyContract(c,assemblies(c))),/New cross-domain dependency .*payroll.closeCurrentShift/);
});

test('a module cannot silently rename its owned function', () => {
  const c = context(), id = unitFor(c,'money');
  c.sources.set(id,c.sources.get(id).replace('function money(', 'function alternateMoney('));
  assert.throws(() => assembleRole(c,'owner'),/Declared symbols changed/);
});

test('missing and repeated executable units fail before generating a page', () => {
  const c = context(); c.manifest.roles.owner.scripts.application.push('not-a-unit');
  assert.throws(() => assembleRole(c,'owner'),/Unknown unit/);
  const d = context(), id = unitFor(d,'money'); d.manifest.roles.owner.scripts.application.push(id);
  assert.throws(() => assembleRole(d,'owner'),/Duplicate unit/);
});

test('syntax errors in a business module stop the build rather than publishing broken JavaScript', () => {
  const c = context(), id = unitFor(c,'money'); c.sources.set(id,c.sources.get(id)+'\nconst = ;');
  assert.throws(() => assembleRole(c,'owner'),SyntaxError);
});

test('lexical dependency analysis handles locals, parameters, destructuring, properties, shorthand and hoisting', () => {
  const code = `const service = {}; const local = 3; function run({value: renamed = service.defaultValue}, service) { const {safe} = service; const result = {service, safe, label: local}; function nested(local) { return local + result.safe; } return nested(renamed); } function reader() { return {local, other: service.value}; }`;
  const ast = parse(code,{ecmaVersion:'latest',sourceType:'module'}),segments=ast.body.map((n,i)=>({id:'u'+i,start:n.start,end:n.end}));
  const result=analyzeScript(ast,segments);
  assert.deepEqual(result.u2.globals,[]);
  assert.deepEqual(result.u2.references.map(x=>x.name),['local']);
  assert.deepEqual(result.u3.references.map(x=>x.name),['local','service']);
  assert.ok(!Object.values(result).flatMap(x=>x.globals).includes('defaultValue'));
});

test('orphan source files and duplicate block markers are rejected', () => {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'crm-modules-'));
  try {
    fs.cpSync(path.join(repositoryRoot,'src'),path.join(tmp,'src'),{recursive:true});
    const orphan=path.join(tmp,'src/crm/orders/forgotten.js'); fs.writeFileSync(orphan,'function forgotten() {}');
    assert.throws(()=>loadSources(tmp),/Unregistered source file/);
    fs.unlinkSync(orphan);
    const c=loadSources(tmp),id=unitFor(c,'money'),file=path.join(c.base,c.manifest.units[id].file);
    fs.appendFileSync(file,`\n/* CRM_UNIT:${id} */function money() {}/* CRM_END:${id} */`);
    assert.throws(()=>loadSources(tmp),/Missing or duplicate source unit/);
  } finally {
    const resolved=path.resolve(tmp),tempRoot=path.resolve(os.tmpdir())+path.sep;
    if(!resolved.startsWith(tempRoot)||!path.basename(resolved).startsWith('crm-modules-')) throw new Error('Refusing to remove unexpected test directory');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});
