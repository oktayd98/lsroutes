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

module.exports = { keyName, nameOf, propertyName, isModuleExports, enclosingClass, constructorOf, arrayIteratedBy };
