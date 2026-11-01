/** Lexical dependency analysis for the compatibility build. No application code runs here. */
export function analyzeScript(ast, segments) {
  const program = { parent: null, kind: 'program', bindings: new Map() };
  const scopes = new WeakMap(), declarations = new WeakSet(), identifiers = [];
  const ownerAt = position => segments.find(x => position >= x.start && position < x.end)?.id;
  function bind(pattern, scope, owner) {
    if (!pattern) return;
    if (pattern.type === 'Identifier') { declarations.add(pattern); scope.bindings.set(pattern.name, owner); }
    else if (pattern.type === 'RestElement') bind(pattern.argument, scope, owner);
    else if (pattern.type === 'AssignmentPattern') bind(pattern.left, scope, owner);
    else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(p => bind(p, scope, owner));
    else if (pattern.type === 'ObjectPattern') pattern.properties.forEach(p => bind(p.type === 'RestElement' ? p.argument : p.value, scope, owner));
  }
  const functionScope = scope => { while (scope.kind !== 'function' && scope.kind !== 'program') scope = scope.parent; return scope; };
  function visit(node, scope, parent, key) {
    if (!node || typeof node !== 'object' || !node.type) return;
    const owner = ownerAt(node.start);
    if (node.type === 'FunctionDeclaration') bind(node.id, scope, owner);
    if (node.type === 'ClassDeclaration') bind(node.id, scope, owner);
    if (/Function(?:Declaration|Expression)$/.test(node.type) || node.type === 'ArrowFunctionExpression') {
      scope = { parent: scope, kind: 'function', bindings: new Map() };
      if (node.id) bind(node.id, scope, owner);
      node.params.forEach(p => bind(p, scope, owner));
    } else if (['BlockStatement','CatchClause','ForStatement','ForInStatement','ForOfStatement','SwitchStatement','ClassExpression','ClassDeclaration'].includes(node.type)) {
      scope = { parent: scope, kind: 'block', bindings: new Map() };
      if (node.type === 'CatchClause') bind(node.param, scope, owner);
      if (node.type.startsWith('Class') && node.id) bind(node.id, scope, owner);
    }
    scopes.set(node, scope);
    if (node.type === 'VariableDeclaration') for (const d of node.declarations) bind(d.id, node.kind === 'var' ? functionScope(scope) : scope, owner);
    if (node.type === 'ImportDeclaration') for (const s of node.specifiers) { bind(s.local, scope, owner); if (s.imported) declarations.add(s.imported); }
    if (node.type === 'Identifier') identifiers.push({ node, scope, parent, key, owner });
    for (const [childKey, child] of Object.entries(node)) {
      if (childKey === 'type') continue;
      if (Array.isArray(child)) child.forEach(n => visit(n, scope, node, childKey));
      else if (child && typeof child === 'object' && child.type) visit(child, scope, node, childKey);
    }
  }
  visit(ast, program, null, '');
  const result = Object.fromEntries(segments.map(s => [s.id, { references: [], globals: [] }]));
  for (const { node, scope, parent, key, owner } of identifiers) {
    if (!owner || declarations.has(node)) continue;
    if (parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed)
      || (['Property','MethodDefinition','PropertyDefinition'].includes(parent.type) && key === 'key' && !parent.computed)
      || (['LabeledStatement','BreakStatement','ContinueStatement'].includes(parent.type) && key === 'label')
      || parent.type === 'MetaProperty')) continue;
    let defining = scope;
    while (defining && !defining.bindings.has(node.name)) defining = defining.parent;
    if (defining === program) result[owner].references.push({ name: node.name, unit: defining.bindings.get(node.name) });
    else if (!defining) result[owner].globals.push(node.name);
  }
  for (const r of Object.values(result)) {
    r.references = [...new Map(r.references.map(x => [x.name + ':' + x.unit, x])).values()].sort((a,b) => a.name.localeCompare(b.name));
    r.globals = [...new Set(r.globals)].sort();
  }
  return result;
}
