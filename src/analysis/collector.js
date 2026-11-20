'use strict';
const { Kind, isRouteTarget } = require('./values');
const { ROUTE_METHODS } = require('./routers');
const { propertyName, enclosingClass, arrayIteratedBy } = require('./ast');
const { placeholder } = require('./expressions');

const MAX_HANDLER_LENGTH = 50;

/**
 * Finds every `app.get(...)`, `router.post(...)`, `router.route(...).put(...)` and `app.use(prefix, router)`
 * call and records it on the app or router it is called on (see routers.js).
 */
class RouteCollector {
  constructor(resolver) {
    this.resolver = resolver;
    this.project = resolver.project;
  }

  collect() {
    for (const file of this.project.sourceFiles()) {
      for (const call of inSourceOrder(file.calls)) {
        const callee = call.get('callee');
        if (!call.isCallExpression() || !callee.isMemberExpression()) continue;
        const method = propertyName(callee);
        if (method === 'use' || ROUTE_METHODS.has(method)) this.collectCall(call, callee, method);
      }
    }
  }

  /** A call inside a loop over an array is collected once per element (see Resolver.withLoopElement). */
  collectCall(call, callee, method) {
    const loop = this.enclosingLoop(call);
    if (!loop || !loop.elements.length) {
      this.collectOnce(call, callee, method);
      return;
    }
    for (const element of loop.elements) {
      this.resolver.withLoopElement(loop.variable, element, () => this.collectOnce(call, callee, method));
    }
  }

  collectOnce(call, callee, method) {
    const targets = this.resolver.resolve(callee.get('object')).filter(isRouteTarget);
    if (!targets.length) return;
    const args = call.get('arguments');
    if (method === 'use') this.collectMounts(targets, args);
    else this.collectRoutes(targets, method, args, call);
  }

  /** `app.use(router)`, `app.use('/prefix', auth, router)`, `app.use('/prefix', [a, b])` */
  collectMounts(targets, args) {
    let prefixes = ['/'];
    let mountedArgs = args;
    const prefix = args.length > 1 && this.prefixOf(args[0]);
    if (prefix) {
      prefixes = prefix;
      mountedArgs = args.slice(1);
    }
    const children = mountedArgs
      .flatMap((arg) => (arg.isArrayExpression() ? arg.get('elements') : [arg]))
      .flatMap((arg) => this.resolver.resolve(arg))
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
  collectRoutes(targets, method, args, call) {
    for (const target of targets) {
      if (target.kind === Kind.ROUTE) {
        this.addRoute(target.router, method, target.path, args, call);
      } else if (args.length >= 2) { // app.get('env') is a settings getter, not a route
        for (const routePath of this.resolver.routePaths(args[0]) || [placeholder(this.resolver, args[0])]) {
          this.addRoute(target.router, method, routePath, args, call);
        }
      }
    }
  }

  addRoute(router, method, routePath, args, call) {
    router.addRoute({ method, path: routePath, handler: this.handlerOf(args), location: this.project.location(call) });
  }

  /**
   * Path prefix of a use() call, or null when the first argument is middleware. An unknown identifier such as
   * `config.apiPrefix` is shown as a placeholder, unless it comes from an npm package (then it is middleware).
   */
  prefixOf(arg) {
    const paths = this.resolver.routePaths(arg);
    if (paths) return paths;
    const unknown = (arg.isIdentifier() || arg.isMemberExpression()) && !this.resolver.resolve(arg).length;
    return unknown && !importedFromPackage(arg) ? [placeholder(this.resolver, arg)] : null;
  }

  /**
   * How the handler (the last argument) is shown: its source (`users.list`), `UserController#list` for
   * `this.list` inside a class, or `function` for an inline function (a reserved word, so no named handler
   * can print exactly that).
   */
  handlerOf(args) {
    const handler = args[args.length - 1];
    if (!handler) return '';
    if (handler.isFunction()) return 'function';
    let text = this.project.sourceText(handler).replace(/\s+/g, ' ');
    const cls = handler.isMemberExpression() && handler.get('object').isThisExpression() && enclosingClass(handler);
    if (cls && cls.node.id) text = `${cls.node.id.name}#${propertyName(handler)}`;
    return text.length > MAX_HANDLER_LENGTH ? text.slice(0, MAX_HANDLER_LENGTH - 3) + '...' : text;
  }

  /** The nearest `array.forEach(item => ...)`, `array.map(...)` or `for (const item of array)` around a call. */
  enclosingLoop(call) {
    for (let path = call.parentPath; path; path = path.parentPath) {
      const iterated = path.isFunction() && path.node.params[0] && arrayIteratedBy(path);
      if (iterated) return { variable: path.node.params[0], elements: this.resolver.elements(this.resolver.resolve(iterated)) };
      if (path.isForOfStatement() && path.node.left.type === 'VariableDeclaration') {
        return { variable: path.node.left.declarations[0], elements: this.resolver.elements(this.resolver.resolve(path.get('right'))) };
      }
    }
    return null;
  }
}

/** Sorted by the method name's position, so `route('/x').put().delete()` lists PUT before DELETE. */
function inSourceOrder(calls) {
  const position = (call) => call.node.callee.property?.start ?? call.node.start;
  return [...calls].sort((a, b) => position(a) - position(b));
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

module.exports = { RouteCollector };
