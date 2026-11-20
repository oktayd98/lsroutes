'use strict';
/**
 * Hono: `new Hono()` apps, `app.get(path, ...handlers)`, `app.on(method, path, ...handlers)`, chains that reuse the
 * previous path (`app.get('/x', h).post(h)`), `app.basePath('/api')` and `app.route('/prefix', subApp)` mounts.
 */
const { Framework } = require('./framework');
const { Kind, Value } = require('../analysis/values');
const { propertyName } = require('../analysis/ast');

const PACKAGES = ['hono', 'hono/tiny', 'hono/quick']; // the presets export the same Hono class
const HONO = Value.framework('hono', 'Hono'); // the class: `new Hono()` creates an app
const ROUTE_METHODS = new Set(['get', 'post', 'put', 'delete', 'options', 'patch', 'all']); // Hono's METHODS + all

// instance methods that return the instance, so `new Hono().use(logger()).get(...)` is still the app
const INSTANCE_METHODS = ['on', 'use', 'route', 'mount', 'onError', 'notFound'];

class Hono extends Framework {
  constructor() {
    super('hono');
    this.packages = PACKAGES;
    this.chainedMethods = new Set([...ROUTE_METHODS, ...INSTANCE_METHODS, 'basePath']);
    this.collectedMethods = new Set([...ROUTE_METHODS, 'on', 'route', 'basePath']);
    this.basePaths = new Map(); // RouterNode made by basePath() -> its base path ('/api/v1' for chained calls)
  }

  packageValue(packageName) {
    return Value.framework('hono', packageName);
  }

  member(resolver, value, name) {
    return PACKAGES.includes(value.symbol) && name === 'Hono' ? [HONO] : [];
  }

  construct(resolver, value, newPath) {
    return value === HONO ? [Value.router(resolver.router('hono', 'app', newPath))] : [];
  }

  /**
   * basePath() returns a copy of the app whose routes all start with the base path; Hono shares the route list
   * between the two, see collectBasePath. Every other method returns the receiver.
   */
  methodResult(resolver, receiver, method, callPath) {
    if (receiver.kind !== Kind.ROUTER) return [];
    if (method !== 'basePath') return [receiver];
    const copy = resolver.router('hono', 'app', callPath);
    const baseArg = callPath.get('arguments.0');
    const base = !baseArg?.node ? '/' : (resolver.routePaths(baseArg) || [resolver.placeholder(baseArg)])[0];
    this.basePaths.set(copy, joinPath(this.basePathOf(receiver.router), base));
    return [Value.router(copy)];
  }

  basePathOf(router) {
    return this.basePaths.get(router) || '/';
  }

  /** A route needs a path and a handler, except in a chain that reuses the previous path: `.get('/x', h).post(h)`. */
  mayCollect(call) {
    if (call.method === 'on') return call.args >= 3;
    if (call.method === 'route') return call.args >= 2;
    if (call.method === 'basePath') return call.args >= 1;
    return !call.notPath && (call.args >= 2 || (call.args === 1 && call.object === 'CallExpression'));
  }

  collectCall(context, targets, method, callPath) {
    const apps = targets.filter((target) => target.kind === Kind.ROUTER).map((target) => target.router);
    if (method === 'basePath') this.collectBasePath(context, apps, callPath);
    else if (method === 'route') this.collectMounts(context, apps, callPath);
    else if (method === 'on') this.collectOn(context, apps, callPath);
    else this.collectRoute(context, apps, method, callPath);
  }

  /**
   * The copy's routes are stored with the base path already in them and the copy is mounted on the original at
   * '/', so mounting either one somewhere else gives the same full paths. Not for `new Hono().basePath('/api')`:
   * nothing else can reach that original.
   */
  collectBasePath(context, apps, callPath) {
    if (callPath.get('callee.object').isNewExpression()) return;
    const copy = context.resolver.resolve(callPath).find((value) => value.kind === Kind.ROUTER);
    for (const app of apps) if (copy && copy.router !== app) app.mount(copy.router, '/');
  }

  /** `app.route('/users', users)`: the sub-app's routes under the receiver's base path and the prefix. */
  collectMounts(context, apps, callPath) {
    const [prefixArg, subAppArg] = callPath.get('arguments');
    const prefixes = context.resolver.routePaths(prefixArg) || [context.resolver.placeholder(prefixArg)];
    const subApps = context.resolver.resolve(subAppArg).filter((value) => value.kind === Kind.ROUTER);
    for (const app of apps) {
      for (const subApp of subApps) {
        for (const prefix of prefixes) if (subApp.router !== app) app.mount(subApp.router, joinPath(this.basePathOf(app), prefix));
      }
    }
  }

  /** `app.on('PURGE', '/cache', h)`, `app.on(['PUT', 'DELETE'], ['/a', '/b'], h)` */
  collectOn(context, apps, callPath) {
    const [methodArg, pathArg, ...handlers] = callPath.get('arguments');
    const methods = (context.resolver.routePaths(methodArg) || [context.resolver.placeholder(methodArg)]).map((name) => name.toLowerCase());
    const paths = context.resolver.routePaths(pathArg) || [context.resolver.placeholder(pathArg)];
    for (const method of methods) this.addRoutes(context, apps, method, paths, handlers, callPath);
  }

  collectRoute(context, apps, method, callPath) {
    const args = callPath.get('arguments');
    const pathless = isPathless(context.resolver, args);
    const paths = pathless ? previousPaths(context.resolver, callPath) : context.resolver.routePaths(args[0]) || [context.resolver.placeholder(args[0])];
    this.addRoutes(context, apps, method, paths, pathless ? args : args.slice(1), callPath);
  }

  addRoutes(context, apps, method, paths, handlers, callPath) {
    if (!handlers.length) return;
    for (const app of apps) {
      for (const routePath of paths) {
        // the method name's line: in a chain (`new Hono().get(...).post(...)`) every call starts on the chain's first line
        const where = callPath.get('callee').isMemberExpression() ? callPath.get('callee.property') : callPath;
        context.addRoute(app, { method, path: joinPath(this.basePathOf(app), routePath), handler: context.handlerOf(handlers), callPath: where });
      }
    }
  }
}

/**
 * Hono takes a first argument that is not a string as a handler: `app.get((c) => ...)`, `.post(handler)`. A lone
 * argument is a handler unless it is a path (a path alone adds no route); with more, an unknown first argument
 * (`app.get(ROUTES.x, h)`) is taken as a path.
 */
function isPathless(resolver, args) {
  if (args.length === 1) return !resolver.routePaths(args[0]);
  return isHandler(resolver, args[0]);
}

function isHandler(resolver, arg) {
  if (!arg) return false;
  if (arg.isFunction()) return true;
  return !resolver.routePaths(arg) && resolver.resolve(arg).some((value) => value.kind === Kind.FUNCTION);
}

/** The path a path-less route reuses: the last one set earlier in the chain, '/' when there is none, as in Hono. */
function previousPaths(resolver, callPath) {
  for (let receiver = callPath.get('callee.object'); receiver.isCallExpression(); receiver = receiver.get('callee.object')) {
    const callee = receiver.get('callee');
    if (!callee.isMemberExpression()) break;
    const method = propertyName(callee);
    const pathArg = receiver.get(method === 'on' ? 'arguments.1' : 'arguments.0');
    const isRouteCall = ROUTE_METHODS.has(method) || method === 'on';
    if (isRouteCall && pathArg && pathArg.node && (method === 'on' || !isPathless(resolver, receiver.get('arguments')))) {
      return resolver.routePaths(pathArg) || [resolver.placeholder(pathArg)];
    }
  }
  return ['/'];
}

/** joinPath('/api', 'users/') -> '/api/users' */
const joinPath = (...parts) => ('/' + parts.join('/')).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

module.exports = { Hono };
