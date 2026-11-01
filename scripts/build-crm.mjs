import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { analyzeScript } from './crm-module-analysis.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const within = (base, relative) => { const p = path.resolve(base, relative); if (p !== base && !p.startsWith(base + path.sep)) throw new Error(`Path escapes source root: ${relative}`); return p; };
const read = p => fs.readFileSync(p, 'utf8');
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

export function loadSources(root = repositoryRoot) {
  const base = path.join(root, 'src/crm'), manifest = JSON.parse(read(path.join(base, 'manifest.json')));
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported CRM manifest schema');
  const sources = new Map(), byFile = new Map();
  for (const [id, unit] of Object.entries(manifest.units)) {
    if (!byFile.has(unit.file)) byFile.set(unit.file, read(within(base, unit.file)));
    const content = byFile.get(unit.file), html = unit.file.endsWith('.html');
    const start = html ? `<!-- CRM_UNIT:${id} -->` : `/* CRM_UNIT:${id} */`;
    const end = html ? `<!-- CRM_END:${id} -->` : `/* CRM_END:${id} */`;
    const at = content.indexOf(start), until = content.indexOf(end, at + start.length);
    if (at < 0 || until < 0 || content.indexOf(start, at + start.length) >= 0) throw new Error(`Missing or duplicate source unit: ${id}`);
    sources.set(id, content.slice(at + start.length, until));
  }
  // Catch abandoned/new source blocks that were not registered in the manifest.
  for (const [file, content] of byFile) for (const match of content.matchAll(/(?:\/\*|<!--) CRM_UNIT:([^ ]+) (?:\*\/|-->)/g)) {
    if (manifest.units[match[1]]?.file !== file) throw new Error(`Unregistered source unit ${match[1]} in ${file}`);
  }
  const registeredFiles = new Set([...byFile.keys(), ...Object.values(manifest.roles).map(r => r.template)]);
  const inspect = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) inspect(absolute);
    else if (/\.(?:js|css|html)$/.test(entry.name)) {
      const relative = path.relative(base, absolute).split(path.sep).join('/');
      if (!registeredFiles.has(relative)) throw new Error(`Unregistered source file: ${relative}`);
    }
  }};
  inspect(base);
  return { root, base, manifest, sources };
}

export function assembleRole(context, role) {
  const { base, manifest, sources } = context, recipe = manifest.roles[role];
  if (!recipe) throw new Error(`Unknown CRM role: ${role}`);
  const used = new Set(), scripts = {};
  const unitText = id => { if (!sources.has(id)) throw new Error(`Unknown unit ${id}`); if (!manifest.units[id].roles.includes(role)) throw new Error(`Unit ${id} is not available to ${role}`); used.add(id); return sources.get(id); };
  for (const [name, ids] of Object.entries(recipe.scripts)) {
    const seen = new Set();
    for (const id of ids) { if (seen.has(id) && !manifest.units[id]?.repeatable) throw new Error(`Duplicate unit in ${role}/${name}: ${id}`); seen.add(id); }
    let text = ''; const segments = [];
    for (const id of ids) { const code = unitText(id), start = text.length; text += code; segments.push({ id, start, end: text.length }); }
    const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
    if (name === 'application') {
      const bindingNames = node => !node ? [] : node.type === 'Identifier' ? [node.name] : node.type === 'RestElement' ? bindingNames(node.argument) : node.type === 'AssignmentPattern' ? bindingNames(node.left) : node.type === 'ArrayPattern' ? node.elements.flatMap(bindingNames) : node.type === 'ObjectPattern' ? node.properties.flatMap(p => bindingNames(p.type === 'RestElement' ? p.argument : p.value)) : [];
      const actualSymbols = Object.fromEntries(ids.map(id => [id, []]));
      for (const node of ast.body) {
        const id = segments.find(s => node.start >= s.start && node.start < s.end)?.id;
        const declared = ['FunctionDeclaration','ClassDeclaration'].includes(node.type) ? bindingNames(node.id) : node.type === 'VariableDeclaration' ? node.declarations.flatMap(d => bindingNames(d.id)) : node.type === 'ImportDeclaration' ? node.specifiers.flatMap(s => bindingNames(s.local)) : [];
        if (id) actualSymbols[id].push(...declared);
      }
      for (const id of ids) if (!same(actualSymbols[id], manifest.units[id].symbols)) throw new Error(`Declared symbols changed for ${id}; review its manifest ownership.`);
    }
    scripts[name] = { text, segments, dependencies: analyzeScript(ast, segments) };
  }
  let html = read(within(base, recipe.template));
  // Screens may contain style references, hence replacement until no tokens remain.
  for (let pass = 0; pass < 5 && /\{\{CRM_/.test(html); pass++) html = html.replace(/\{\{CRM_(SCRIPT|STYLE|SCREEN):([^}]+)\}\}/g, (_, kind, id) => {
    if (kind === 'SCRIPT') { if (!scripts[id]) throw new Error(`Unknown script ${id}`); return scripts[id].text; }
    return unitText(id);
  });
  if (/\{\{CRM_/.test(html)) throw new Error(`Unresolved source token in ${role}`);
  // Parse every final inline script too, including small role/bootstrap scripts.
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) if (!/\bsrc\s*=/.test(match[1])) parse(match[2], { ecmaVersion: 'latest', sourceType: /type="module"/.test(match[1]) ? 'module' : 'script' });
  return { html, scripts, used, output: recipe.output };
}

export function dependencyContract(context, assemblies) {
  const contract = { schemaVersion: 1, roles: {} };
  for (const [role, assembly] of Object.entries(assemblies)) {
    contract.roles[role] = {};
    for (const [script, info] of Object.entries(assembly.scripts)) {
      const entries = {};
      for (const [id, references] of Object.entries(info.dependencies)) entries[id] = {
        globals: references.globals,
        crossDomain: references.references.filter(ref => ref.unit && context.manifest.units[id].domain !== context.manifest.units[ref.unit].domain).map(ref => ({ symbol: ref.name, domain: context.manifest.units[ref.unit].domain })).sort((a,b) => a.symbol.localeCompare(b.symbol))
      };
      contract.roles[role][script] = entries;
    }
  }
  return contract;
}

export function validateContract(expected, actual) {
  const errors = [];
  for (const [role, scripts] of Object.entries(actual.roles)) for (const [script, units] of Object.entries(scripts)) for (const [id, refs] of Object.entries(units)) {
    const prior = expected.roles?.[role]?.[script]?.[id];
    if (!prior) { errors.push(`New unreviewed unit ${role}/${script}/${id}`); continue; }
    for (const name of refs.globals) if (!prior.globals.includes(name)) errors.push(`New unresolved/global reference ${name} in ${role}/${id}`);
    for (const ref of refs.crossDomain) if (!prior.crossDomain.some(old => same(old,ref))) errors.push(`New cross-domain dependency ${role}/${id} -> ${ref.domain}.${ref.symbol}`);
  }
  if (errors.length) throw new Error(errors.join('\n') + '\nReview module dependencies, then explicitly run --update-contracts.');
}

export function buildCRM({ root = repositoryRoot, check = false, updateContracts = false } = {}) {
  const context = loadSources(root), assemblies = Object.fromEntries(Object.keys(context.manifest.roles).map(role => [role, assembleRole(context,role)]));
  const used = new Set(Object.values(assemblies).flatMap(a => [...a.used]));
  for (const id of context.sources.keys()) if (!used.has(id)) throw new Error(`Unused source unit: ${id}`);
  const actual = dependencyContract(context, assemblies), contractFile = path.join(context.base, 'dependency-contract.json');
  if (updateContracts) fs.writeFileSync(contractFile, JSON.stringify(actual,null,2) + '\n');
  else validateContract(JSON.parse(read(contractFile)), actual);
  const changed = [];
  for (const [role, result] of Object.entries(assemblies)) {
    const target = within(path.join(root, 'hosted-snapshot'), result.output);
    if (read(target) !== result.html) { changed.push(result.output); if (!check) fs.writeFileSync(target, result.html); }
  }
  if (check && changed.length) throw new Error(`Generated CRM is stale: ${changed.join(', ')}. Run npm run build:crm.`);
  return { roles: Object.keys(assemblies), units: used.size, updated: changed, dependencies: 'verified' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(buildCRM({ check: process.argv.includes('--check'), updateContracts: process.argv.includes('--update-contracts') }),null,2)); }
  catch(error) { console.error(error.message); process.exitCode = 1; }
}
