'use strict';
const { isRouteTarget } = require('./values');
const { propertyName, enclosingClass, arrayIteratedBy } = require('./ast');

const MAX_HANDLER_LENGTH = 50;

/**
 * Finds the calls that define routes or mount routers (`app.get(...)`, `router.use(...)`, `fastify.register(...)`)
 * and lets the framework of the receiver record them; then gives every framework a pass over the whole project.
 */
class RouteCollector {
  constructor(resolver) {
    this.resolver = resolver;
    this.context = new CollectContext(resolver);
  }

  collect() {
    const { frameworks } = this.resolver;
    for (const file of this.resolver.project.sourceFiles()) {
      // judged from the summaries first: a file is only parsed for paths if one of its calls may matter
      const candidates = file.callSummaries.filter((call) => call.object !== 'Super' && frameworks.mayCollect(call, file)); // super.get() is never a router
      for (const summary of inSourceOrder(candidates)) {
        const call = file.callAt(summary);
        const callee = call && call.get('callee');
        if (call && call.isCallExpression() && callee.isMemberExpression()) this.collectCall(call, callee, summary.method);
      }
    }
    for (const framework of frameworks.all()) framework.collectProject(this.context);
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
    for (const [framework, frameworkTargets] of this.byFramework(targets)) {
      if (framework.collectedMethods.has(method)) framework.collectCall(this.context, frameworkTargets, method, call);
    }
  }

  byFramework(targets) {
    const groups = new Map(); // framework adapter -> targets, in order of first appearance
    for (const target of targets) {
      const framework = this.resolver.frameworks.of(target);
      if (!groups.has(framework)) groups.set(framework, []);
      groups.get(framework).push(target);
    }
    return groups;
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

/** What framework adapters get to record routes: the resolver, the project and shared helpers. */
class CollectContext {
  constructor(resolver) {
    this.resolver = resolver;
    this.project = resolver.project;
  }

  /** Records a route on a router; `callPath` is where it is defined. */
  addRoute(router, { method, path, handler, callPath }) {
    router.addRoute({ method, path, handler, location: this.project.location(callPath) });
  }

  /** How the handler of a call is shown: the last argument, see describeHandler. */
  handlerOf(args) {
    const handler = args[args.length - 1];
    return handler ? this.describeHandler(handler) : '';
  }

  /**
   * How a handler is shown: its source (`users.list`), `UserController#list` for `this.list` inside a class,
   * or `function` for an inline function (a reserved word, so no named handler can print exactly that).
   */
  describeHandler(handler) {
    if (handler.isFunction()) return 'function';
    let text = this.project.sourceText(handler).replace(/\s+/g, ' ');
    const cls = handler.isMemberExpression() && handler.get('object').isThisExpression() && enclosingClass(handler);
    if (cls && cls.node.id) text = `${cls.node.id.name}#${propertyName(handler)}`;
    return text.length > MAX_HANDLER_LENGTH ? text.slice(0, MAX_HANDLER_LENGTH - 3) + '...' : text;
  }
}

/** Sorted by the method name's position, so `route('/x').put().delete()` lists PUT before DELETE. */
const inSourceOrder = (summaries) => summaries.sort((a, b) => a.order - b.order);

module.exports = { RouteCollector };
