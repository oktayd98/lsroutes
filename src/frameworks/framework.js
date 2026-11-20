'use strict';
/**
 * Base class of the framework adapters. Everything specific to one web framework (Express, Fastify, ...)
 * lives in its adapter; the analysis core asks the adapters through these hooks and never names a framework.
 *
 * Every hook has a do-nothing default, so an adapter overrides only what its framework needs:
 *
 *   packages, packageValue   what `import x from '<package>'` / `require('<package>')` is
 *   member, call, construct  what `x.name`, `x(...)` and `new x(...)` are for the framework's own values
 *                            (express.Router, express(), new Hono(), ...)
 *   chainedMethods,          what `router.method(...)` returns: usually the router itself (chaining)
 *   methodResult
 *   collectedMethods,        which `router.method(...)` calls define routes or mount routers, and recording them;
 *   mayCollect, collectCall  mayCollect rules calls out from their summary alone, before anything is resolved
 *   parameterValues          extra values for a function parameter (a Fastify plugin's instance parameter)
 *   collectProject           a pass over the whole project, for frameworks whose routes are not method calls
 *                            (NestJS decorators)
 *
 * Framework values are { kind: Kind.FRAMEWORK, framework: <adapter name>, symbol, ... } (see values.js).
 */
class Framework {
  /** @param {string} name */
  constructor(name) {
    this.name = name;
    this.packages = []; // npm package names owned by this framework
    this.chainedMethods = new Set(); // router methods resolved by methodResult instead of as ordinary calls
    this.collectedMethods = new Set(); // router methods passed to collectCall
  }

  /** The value of a whole package import or require(), or null. */
  packageValue(packageName) {
    return null;
  }

  /** Values of `value.name` for one of this framework's values. */
  member(resolver, value, name) {
    return [];
  }

  /** Values of calling one of this framework's values: `express()`, `Router()`. */
  call(resolver, value, callPath) {
    return [];
  }

  /** Values of `new` on one of this framework's values: `new Router()`. */
  construct(resolver, value, newPath) {
    return [];
  }

  /** Values of `router.method(...)` for a method in chainedMethods; `receiver` is a router or route value. */
  methodResult(resolver, receiver, method, callPath) {
    return [];
  }

  /**
   * False when a call to a method in collectedMethods cannot define a route or mount, judging from its summary
   * (see SourceFile: argument count, method name) and its file: such calls are skipped without parsing the file
   * for paths, which is what keeps memory low on large projects. `Map.get(key)` has too few arguments, say.
   */
  mayCollect(call, file) {
    return true;
  }

  /** Records the routes or mounts made by `router.method(...)` for a method in collectedMethods. */
  collectCall(context, targets, method, callPath) {}

  /** Extra values a function parameter can hold because of how the framework calls the function. */
  parameterValues(resolver, functionPath, index) {
    return [];
  }

  /** A pass over the whole project after the method calls are collected. */
  collectProject(context) {}
}

module.exports = { Framework };
