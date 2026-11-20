'use strict';
/**
 * Express: `express()` apps, `express.Router()` routers, `app.get(path, ...handlers)`,
 * `router.route(path).get(...).post(...)` chains and `app.use(prefix, router)` mounts.
 */
const { Framework } = require('./framework');
const { ROUTE_METHODS } = require('./httpMethods');
const { Kind, Value } = require('../analysis/values');

const EXPRESS = Value.framework('express', 'express'); // the module: express() creates an app
const ROUTER_FACTORY = Value.framework('express', 'Router'); // express.Router: calling it creates a router

class Express extends Framework {
  constructor() {
    super('express');
    this.packages = ['express'];
    this.chainedMethods = new Set(['use', 'route', ...ROUTE_METHODS]);
    this.collectedMethods = new Set(['use', ...ROUTE_METHODS]);
  }

  packageValue() {
    return EXPRESS;
  }

  member(resolver, value, name) {
    return value.symbol === 'express' && name === 'Router' ? [ROUTER_FACTORY] : [];
  }

  call(resolver, value, callPath) {
    if (value.symbol === 'express') return [Value.router(resolver.router('express', 'app', callPath))];
    if (value.symbol === 'Router') return [Value.router(resolver.router('express', 'router', callPath))];
    return [];
  }

  construct(resolver, value, newPath) {
    return value.symbol === 'Router' ? [Value.router(resolver.router('express', 'router', newPath))] : [];
  }

  /** router.route('/x') starts a route chain; every other router method returns the receiver (chaining). */
  methodResult(resolver, receiver, method, callPath) {
    if (method !== 'route') return [receiver];
    if (receiver.kind !== Kind.ROUTER) return [];
    const pathArgument = callPath.get('arguments.0');
    const paths = resolver.routePaths(pathArgument) || [resolver.placeholder(pathArgument)];
    return paths.map((routePath) => Value.route(receiver.router, routePath));
  }

  /**
   * `use(router)` takes one argument and a route needs a path and a handler, except on a `route('/x')` chain;
   * a string not starting with '/' or '*' is no path (`config.get('port', 80)`).
   * shortcut: a route chain is recognized by a route() call in the same file, so `route.get(h)` on a route
   * imported from another file is missed; look at the receiver's value instead if that turns up.
   */
  mayCollect(call, file) {
    if (call.method === 'use') return call.args >= 1;
    return (call.args >= 2 && !call.notPath) || (call.args === 1 && file.callsMethod('route'));
  }

  collectCall(context, targets, method, callPath) {
    const args = callPath.get('arguments');
    if (method === 'use') collectMounts(context, targets, args);
    else collectRoutes(context, targets, method, args, callPath);
  }
}

/** `app.use(router)`, `app.use('/prefix', auth, router)`, `app.use('/prefix', [a, b])` */
function collectMounts(context, targets, args) {
  let prefixes = ['/'];
  let mountedArgs = args;
  const prefix = args.length > 1 && prefixOf(context, args[0]);
  if (prefix) {
    prefixes = prefix;
    mountedArgs = args.slice(1);
  }
  const children = mountedArgs
    .flatMap((arg) => (arg.isArrayExpression() ? arg.get('elements') : [arg]))
    .flatMap((arg) => context.resolver.resolve(arg))
    .filter((value) => value.kind === Kind.ROUTER);
  for (const target of targets) {
    for (const child of children) {
      for (const mountPath of prefixes) {
        if (target.kind !== Kind.ROUTER || child.router === target.router) continue;
        target.router.mount(child.router, mountPath);
      }
    }
  }
}

/** `app.get('/path', handler)`, `router.route('/path').get(handler)` */
function collectRoutes(context, targets, method, args, callPath) {
  for (const target of targets) {
    if (target.kind === Kind.ROUTE) {
      context.addRoute(target.router, { method, path: target.path, handler: context.handlerOf(args), callPath });
    } else if (args.length >= 2) { // app.get('env') is a settings getter, not a route
      for (const routePath of context.resolver.routePaths(args[0]) || [context.resolver.placeholder(args[0])]) {
        context.addRoute(target.router, { method, path: routePath, handler: context.handlerOf(args), callPath });
      }
    }
  }
}

/**
 * Path prefix of a use() call, or null when the first argument is middleware. An unknown identifier such as
 * `config.apiPrefix` is shown as a placeholder, unless it comes from an npm package (then it is middleware).
 */
function prefixOf(context, arg) {
  const paths = context.resolver.routePaths(arg);
  if (paths) return paths;
  const unknown = (arg.isIdentifier() || arg.isMemberExpression()) && !context.resolver.resolve(arg).length;
  return unknown && !importedFromPackage(arg) ? [context.resolver.placeholder(arg)] : null;
}

/** True when the root identifier of `a.b.c` is imported or required from an npm package. */
function importedFromPackage(path) {
  while (path.isMemberExpression()) path = path.get('object');
  const binding = path.isIdentifier() && path.scope.getBinding(path.node.name);
  if (!binding) return false;
  const declaration = binding.path;
  let source = declaration.isImportSpecifier() || declaration.isImportDefaultSpecifier() || declaration.isImportNamespaceSpecifier()
    ? declaration.parent.source
    : null;
  if (!source && declaration.isVariableDeclarator()) {
    // walk `require('pkg').a.b()` down to the require call
    let init = declaration.node.init;
    while (init && (init.type === 'MemberExpression' || (init.type === 'CallExpression' && init.callee.name !== 'require'))) {
      init = init.object || init.callee;
    }
    source = init && init.type === 'CallExpression' ? init.arguments[0] : null;
  }
  return !!source && source.type === 'StringLiteral' && !source.value.startsWith('.');
}

module.exports = { Express };
