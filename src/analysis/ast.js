'use strict';
// Small helpers over Babel AST nodes and NodePaths, shared by the analysis modules.

/** Key of an object property or class member: `{ a: 1 }`, `{ 'a': 1 }` -> 'a'. Other computed keys -> null. */
function keyName(node) {
  if (node.computed) return node.key.type === 'StringLiteral' ? node.key.value : null;
  return node.key.name ?? node.key.value;
}

/** Name of an Identifier or a StringLiteral node (import and export specifiers can be either). */
const nameOf = (node) => node.name ?? node.value;

/** Property of a member expression: `a.b`, `a['b']` -> 'b'. Other computed properties -> null. */
function propertyName(memberPath) {
  const { computed, property } = memberPath.node;
  if (computed) return property.type === 'StringLiteral' ? property.value : null;
  return property.name;
}

const isModuleExports = (node) =>
  node.type === 'MemberExpression' && node.object.name === 'module' && node.property.name === 'exports';

const enclosingClass = (path) => path.findParent((parent) => parent.isClass());

const constructorOf = (classPath) => classPath.get('body.body').find((member) => member.isClassMethod({ kind: 'constructor' }));

/** For a callback passed to `array.forEach(...)` or `array.map(...)`, the path of `array`; otherwise null. */
function arrayIteratedBy(callbackPath) {
  const call = callbackPath.parentPath;
  const callee = call.isCallExpression() && call.node.arguments[0] === callbackPath.node && call.get('callee');
  const iterates = callee && callee.isMemberExpression() && ['forEach', 'map'].includes(propertyName(callee));
  return iterates ? callee.get('object') : null;
}

/**
 * Names under which code can call a function (or construct a class, for a constructor): its own name, the names
 * of everything enclosing it (`const routes = { register(app) {} }`: 'register', 'routes') and the names its file
 * exports those under (`export { a as b }`, `exports.b = a`, 'default'). An over-approximation by design: it only
 * rules out calls that cannot reach the function, see Resolver.callersOf.
 */
function callableNames(functionPath) {
  const names = new Set();
  let program = null;
  for (let path = functionPath; path; path = path.parentPath) {
    const { node } = path;
    if (path.isProgram()) program = path;
    else if (node.id && node.id.type === 'Identifier') names.add(node.id.name); // functions, classes, `const x = ...`
    if ((path.isObjectMember() || path.isClassMethod() || path.isClassProperty()) && keyName(node)) names.add(keyName(node));
    if (path.isAssignmentExpression() && isModuleExports(node.left)) names.add('default');
    else if (path.isAssignmentExpression() && node.left.type === 'MemberExpression') names.add(propertyName(path.get('left')));
    else if (path.isAssignmentExpression() && node.left.type === 'Identifier') names.add(node.left.name);
    if (path.isExportDefaultDeclaration() || path.isTSExportAssignment()) names.add('default');
  }
  for (const statement of program ? program.node.body : []) {
    for (const specifier of statement.type === 'ExportNamedDeclaration' && !statement.source ? statement.specifiers : []) {
      if (names.has(nameOf(specifier.local))) names.add(nameOf(specifier.exported));
    }
    const exported = statement.type === 'ExportDefaultDeclaration' || statement.type === 'TSExportAssignment' ? statement.declaration || statement.expression
      : statement.type === 'ExpressionStatement' && statement.expression.type === 'AssignmentExpression' ? statement.expression.right : null;
    if (!exported || !isNamedIn(exported, names)) continue;
    const target = statement.type === 'ExpressionStatement' ? statement.expression.left : null;
    if (!target || isModuleExports(target)) names.add('default');
    else if (target.type === 'MemberExpression' && !target.computed) names.add(target.property.name); // exports.b = a
  }
  return names;
}

/** `a` with a in names, or an object literal with a property `b: a` / `a` (then b is added too). */
function isNamedIn(expression, names) {
  if (expression.type === 'Identifier') return names.has(expression.name);
  if (expression.type !== 'ObjectExpression') return false;
  let found = false;
  for (const property of expression.properties) {
    if (property.type === 'ObjectProperty' && property.value.type === 'Identifier' && names.has(property.value.name) && keyName(property)) {
      names.add(keyName(property));
      found = true;
    }
  }
  return found;
}

module.exports = { keyName, nameOf, propertyName, isModuleExports, enclosingClass, constructorOf, arrayIteratedBy, callableNames };
