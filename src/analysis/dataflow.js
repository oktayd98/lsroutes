'use strict';
// Rules: how values flow through variables, parameters, return statements and arrays.
const { Kind } = require('./values');
const { keyName, arrayIteratedBy } = require('./ast');

/** Values a variable, import, function or class declaration, or parameter can hold. */
function bindingValues(resolver, binding) {
  const declaration = binding.path;
  if (declaration.isVariableDeclarator()) return variableValues(resolver, binding);
  if (declaration.isImportSpecifier() || declaration.isImportDefaultSpecifier() || declaration.isImportNamespaceSpecifier()) {
    return resolver.importValues(declaration);
  }
  if (declaration.isFunctionDeclaration() || declaration.isClassDeclaration()) return resolver.resolve(declaration);
  if (binding.kind === 'param') return parameterBindingValues(resolver, binding);
  return [];
}

/** `const x = init`, `for (const x of list)`, plus every later `x = ...` assignment. */
function variableValues(resolver, binding) {
  const declarator = binding.path;
  const statement = declarator.parentPath.parentPath;
  let values = resolver.loopElement(declarator.node);
  if (!values) {
    if (declarator.node.init) values = resolver.resolve(declarator.get('init'));
    else if (statement.isForOfStatement()) values = resolver.elements(resolver.resolve(statement.get('right')));
    else values = [];
  }
  for (const change of binding.constantViolations) {
    if (change.isAssignmentExpression()) values = values.concat(resolver.resolve(change.get('right')));
  }
  return destructure(resolver, declarator.node.id, binding.identifier.name, values);
}

function parameterBindingValues(resolver, binding) {
  const param = binding.path;
  const fn = param.findParent((parent) => parent.isFunction());
  // `(app)`, `(app = x)`, TypeScript's `constructor(private app: App)`
  const index = fn ? fn.node.params.findIndex((p) => p === param.node || p.left === param.node || p.parameter === param.node) : -1;
  if (index < 0) return [];
  const values = resolver.loopElement(param.node) ?? resolver.parameterValues(fn, index);
  return destructure(resolver, param.node, binding.identifier.name, values);
}

/** Picks `name` out of a destructuring pattern: `const { router } = x` -> x.router. */
function destructure(resolver, pattern, name, values) {
  if (pattern.type === 'Identifier' || pattern.type === 'AssignmentPattern') return values;
  const property = pattern.type === 'ObjectPattern' && pattern.properties.find((p) => p.value && p.value.name === name);
  return property ? resolver.member(values, keyName(property)) : [];
}

/** Arguments a parameter receives: from every call site, or the elements of `array` for `array.forEach(item => ...)`. */
function parameterValues(resolver, fn, index) {
  const iterated = index === 0 && arrayIteratedBy(fn);
  if (iterated) return resolver.elements(resolver.resolve(iterated));
  return resolver.callersOf(fn).flatMap((call) => resolver.resolve(call.get(`arguments.${index}`)));
}

/** What a function returns: its expression body, or the arguments of its return statements (not those of nested functions). */
function returnValues(resolver, fn) {
  const body = fn.get('body');
  if (!body.isBlockStatement()) return resolver.resolve(body);
  const values = [];
  body.traverse({
    Function(nested) { nested.skip(); },
    ReturnStatement(statement) { values.push(...resolver.resolve(statement.get('argument'))); },
  });
  return values;
}

/** Elements of array values, following spreads. Guarded per array: `list = [...list, x]` spreads itself. */
function elements(resolver, values) {
  return values
    .filter((value) => value.kind === Kind.ARRAY)
    .flatMap((array) => resolver.guard(`${resolver.project.fileOf(array.literal).filePath}:${array.literal.node.start}#elements`, () =>
      array.literal.get('elements').flatMap((element) =>
        (element.isSpreadElement() ? elements(resolver, resolver.resolve(element.get('argument'))) : resolver.resolve(element)))));
}

module.exports = { bindingValues, parameterValues, returnValues, elements };
