'use strict';
const { Kind } = require('../analysis/values');
const { Express } = require('./express');
const { Fastify } = require('./fastify');
const { NestJS } = require('./nestjs');
const { Hono } = require('./hono');

/**
 * The framework adapters of one analysis run (adapters may keep per-run state, so each run creates its own).
 * To support a new framework: write an adapter extending Framework (framework.js) and add it here.
 */
function createFrameworks() {
  return new Frameworks([new Express(), new Fastify(), new NestJS(), new Hono()]);
}

class Frameworks {
  constructor(adapters) {
    this.adapters = adapters;
    this.byName = new Map(adapters.map((adapter) => [adapter.name, adapter]));
    this.byPackage = new Map(adapters.flatMap((adapter) => adapter.packages.map((name) => [name, adapter])));
    this.chainedMethods = new Set(adapters.flatMap((adapter) => [...adapter.chainedMethods]));
    this.collectedMethods = new Set(adapters.flatMap((adapter) => [...adapter.collectedMethods]));
  }

  all() {
    return this.adapters;
  }

  /** The adapter owning a framework value or a router/route value. */
  of(value) {
    return this.byName.get(value.kind === Kind.FRAMEWORK ? value.framework : value.router.framework);
  }

  get(name) {
    return this.byName.get(name);
  }

  /** The value of `import x from '<packageName>'` when a framework owns that package, otherwise null. */
  packageValue(packageName) {
    const adapter = this.byPackage.get(packageName);
    return adapter ? adapter.packageValue(packageName) : null;
  }

  /** True when some framework collects calls to this method and does not rule the call out (see Framework.mayCollect). */
  mayCollect(call, file) {
    return this.adapters.some((adapter) => adapter.collectedMethods.has(call.method) && adapter.mayCollect(call, file));
  }

  /** Extra values of a function parameter, from every framework. */
  parameterValues(resolver, functionPath, index) {
    return this.adapters.flatMap((adapter) => adapter.parameterValues(resolver, functionPath, index));
  }
}

module.exports = { createFrameworks };
