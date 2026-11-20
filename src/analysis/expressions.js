'use strict';
// Rules: what each kind of expression evaluates to. One small rule per Babel node type.
const { Kind, Value, isRouteTarget } = require('./values');
const { ROUTE_METHODS } = require('./routers');
const { propertyName, enclosingClass } = require('./ast');

/** @returns {object[]} values, see values.js */
function resolveExpression(resolver, path) {
  const rule = RULES[path.node.type];
  return rule ? rule(resolver, path) : [];
}

const resolveInner = (key) => (resolver, path) => resolver.resolve(path.get(key));
const resolveEither = (a, b) => (resolver, path) => [...resolver.resolve(path.get(a)), ...resolver.resolve(path.get(b))];
const asFunction = (resolver, path) => [Value.function(path)];
const asClass = (resolver, path) => [Value.class(path)];

const RULES = {
  StringLiteral: (resolver, path) => [Value.string(path.node.value)],
  TemplateLiteral: resolveTemplate,
  BinaryExpression: resolveConcatenation,
  Identifier: resolveIdentifier,
  ThisExpression: resolveThis,
  MemberExpression: resolveMember,
  OptionalMemberExpression: resolveMember,
  CallExpression: resolveCall,
  OptionalCallExpression: resolveCall,
  NewExpression: resolveNew,
  // wrappers that do not change the value
  TSAsExpression: resolveInner('expression'),
  TSSatisfiesExpression: resolveInner('expression'),
  TSNonNullExpression: resolveInner('expression'),
  TSTypeAssertion: resolveInner('expression'),
  ParenthesizedExpression: resolveInner('expression'),
  AwaitExpression: resolveInner('argument'),
  AssignmentExpression: resolveInner('right'),
  ConditionalExpression: resolveEither('consequent', 'alternate'),
  LogicalExpression: resolveEither('left', 'right'),
  ArrayExpression: (resolver, path) => [Value.array(path)],
  ObjectExpression: (resolver, path) => [Value.object(path)],
  FunctionDeclaration: asFunction,
  FunctionExpression: asFunction,
  ArrowFunctionExpression: asFunction,
  ObjectMethod: asFunction,
  ClassMethod: asFunction,
  ClassDeclaration: asClass,
  ClassExpression: asClass,
};

// `/api/${version}`: unknown parts are kept as their source, see stringOf
function resolveTemplate(resolver, path) {
  const { quasis, expressions } = path.node;
  const text = quasis.map((quasi, i) => quasi.value.cooked + (i < expressions.length ? stringOf(resolver, path.get(`expressions.${i}`)) : ''));
  return [Value.string(text.join(''))];
}

function resolveConcatenation(resolver, path) {
  if (path.node.operator !== '+') return [];
  return [Value.string(stringOf(resolver, path.get('left')) + stringOf(resolver, path.get('right')))];
}

function resolveIdentifier(resolver, path) {
  const binding = path.scope.getBinding(path.node.name);
  return binding ? resolver.resolveBinding(binding) : [];
}

function resolveThis(resolver, path) {
  const cls = enclosingClass(path);
  return cls ? [Value.instance(cls)] : [];
}

function resolveMember(resolver, path) {
  const name = propertyName(path);
  return name == null ? [] : resolver.member(resolver.resolve(path.get('object')), name);
}

function resolveNew(resolver, path) {
  return resolver.resolve(path.get('callee')).flatMap((callee) => {
    if (callee.kind === Kind.CLASS) return [Value.instance(callee.declaration)];
    if (callee.kind === Kind.ROUTER_FACTORY) return [Value.router(resolver.router('router', path))];
    return [];
  });
}

// --- calls ------------------------------------------------------------------------------

/**
 * Special forms first, each returns null when it does not apply; then an ordinary call.
 * The callee is looked up once and passed along: Babel's path.get() is costly on hot paths.
 */
function resolveCall(resolver, path) {
  const callee = path.get('callee');
  return resolveRequire(resolver, path, callee)
    ?? resolveObjectAssign(resolver, path, callee)
    ?? resolveRouterMethod(resolver, path, callee)
    ?? resolveOrdinaryCall(resolver, path, callee);
}

/** require('express'), require('./routes') */
function resolveRequire(resolver, path, callee) {
  if (!callee.isIdentifier({ name: 'require' }) || path.scope.getBinding('require')) return null;
  const specifier = path.node.arguments[0];
  if (!specifier || specifier.type !== 'StringLiteral') return [];
  if (specifier.value === 'express') return [Value.express()];
  const file = resolver.project.resolveImport(resolver.project.fileOf(path).filePath, specifier.value);
  return file ? resolver.requireOf(file) : [];
}

/** Object.assign(router, helpers) returns the router itself (factories attaching helpers to it). */
function resolveObjectAssign(resolver, path, callee) {
  const isObjectAssign = callee.isMemberExpression() && propertyName(callee) === 'assign'
    && callee.get('object').isIdentifier({ name: 'Object' }) && !path.scope.getBinding('Object');
  return isObjectAssign ? resolver.resolve(path.get('arguments.0')) : null;
}

/** router.route('/x') starts a route chain; router.get(...) and router.use(...) return the router (chaining). */
function resolveRouterMethod(resolver, path, callee) {
  if (!callee.isMemberExpression()) return null;
  const method = propertyName(callee);
  if (method === 'route') {
    const pathArgument = path.get('arguments.0');
    const routePathsOfCall = routePaths(resolver, pathArgument) || [placeholder(resolver, pathArgument)];
    const routers = resolver.resolve(callee.get('object')).filter((value) => value.kind === Kind.ROUTER);
    return routers.flatMap((value) => routePathsOfCall.map((routePath) => Value.route(value.router, routePath)));
  }
  if (method === 'use' || ROUTE_METHODS.has(method)) return resolver.resolve(callee.get('object')).filter(isRouteTarget);
  return null;
}

/** express() makes an app, Router() a router, a project function returns whatever it returns. */
function resolveOrdinaryCall(resolver, path, callee) {
  return resolver.resolve(callee).flatMap((called) => {
    if (called.kind === Kind.EXPRESS) return [Value.router(resolver.router('app', path))];
    if (called.kind === Kind.ROUTER_FACTORY) return [Value.router(resolver.router('router', path))];
    if (called.kind === Kind.FUNCTION) return resolver.returnValues(called.declaration);
    return [];
  });
}

// --- strings and paths --------------------------------------------------------------------

/** The string an expression evaluates to, or its source in braces when unknown: `{process.env.PREFIX}`. */
function stringOf(resolver, path) {
  const string = resolver.resolve(path).find((value) => value.kind === Kind.STRING);
  return string ? string.value : placeholder(resolver, path);
}

const placeholder = (resolver, path) => `{${resolver.project.sourceText(path)}}`;

/** Route paths an argument can be: '/a', ['/a', '/b'], a constant, a regex. Null when it is not a path. */
function routePaths(resolver, path) {
  if (!path || !path.node) return null;
  if (path.isArrayExpression()) {
    const all = path.get('elements').map((element) => routePaths(resolver, element));
    return all.every(Boolean) ? all.flat() : null;
  }
  if (path.isRegExpLiteral()) return [`/${path.node.pattern}/`];
  const strings = resolver.resolve(path).filter((value) => value.kind === Kind.STRING).map((value) => value.value);
  return strings.length ? strings : null;
}

module.exports = { resolveExpression, stringOf, routePaths, placeholder };
