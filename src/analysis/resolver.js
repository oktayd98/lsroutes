'use strict';
const { Kind } = require('./values');
const { RouterRegistry } = require('./routers');
const { constructorOf } = require('./ast');
const expressions = require('./expressions');
const dataflow = require('./dataflow');
const members = require('./members');
const modules = require('./modules');

// Real router flows are a few levels deep. Long value chains through unrelated code (a helper passing its
// argument to the next helper, 1000 times) would otherwise overflow the call stack.
const MAX_DEPTH = 150;

/**
 * Answers "what can this expression be?" for any expression of the project (see values.js).
 *
 * The resolver is the hub of the analysis. The rules live in expressions.js, dataflow.js, members.js and
 * modules.js; they call back into the resolver for every sub-question and never into each other, so each
 * rule module can be read on its own.
 *
 * The analyzed code can be cyclic (`s = s.slice(1)`, `list = [...list, x]`, functions calling each other),
 * so every step goes through guard(), which cuts cycles, caps the depth and memoizes results.
 */
class Resolver {
  /**
   * @param {import('../project/project').Project} project
   * @param {object} frameworks the framework adapters, see frameworks/index.js
   */
  constructor(project, frameworks) {
    this.project = project;
    this.frameworks = frameworks;
    this.routers = new RouterRegistry(project);
    this.memo = new Map(); // without it, code like jQuery re-resolves the same chains exponentially
    this.inProgress = new Set(); // keys being resolved right now: meeting one again means a cycle
    this.cycleCuts = 0; // a result computed while a cycle was cut may be partial, so it is not memoized...
    // ...but it is reused until the outermost question is answered: in a cyclic call graph (services passing
    // `log` to each other) recomputing it at every visit is exponential
    this.provisional = new Map();
    this.loopElements = new Map(); // loop variable node -> [the one element being processed], see withLoopElement
    this.callers = null; // function node -> call and new expressions invoking it, built on first use
  }

  // --- questions the rules ask --------------------------------------------------------

  /** Values of an expression. */
  resolve(path) {
    if (!path || !path.node) return [];
    return this.guard(path.node, () => expressions.resolveExpression(this, path));
  }

  /** Values of a variable, parameter, import or declaration. Keyed by binding, not by reference: `s = s.slice(1)` repeated N times would otherwise recurse N! deep. */
  resolveBinding(binding) {
    return this.guard(binding, () => dataflow.bindingValues(this, binding));
  }

  /** The string an expression evaluates to, or its source code in braces when unknown: `{process.env.PREFIX}`. */
  stringOf(path) {
    return expressions.stringOf(this, path);
  }

  /** Route paths an argument can be (`'/a'`, `['/a', '/b']`, a constant, a regex), or null if it is not a path. */
  routePaths(path) {
    return expressions.routePaths(this, path);
  }

  /** How an unknown value is shown: its source code in braces, `{config.prefix}`. */
  placeholder(path) {
    return expressions.placeholder(this, path);
  }

  member(values, name) {
    return members.memberOf(this, values, name);
  }

  /** Elements of array values, following spreads. */
  elements(values) {
    return dataflow.elements(this, values);
  }

  returnValues(functionPath) {
    return dataflow.returnValues(this, functionPath);
  }

  parameterValues(functionPath, index) {
    return dataflow.parameterValues(this, functionPath, index);
  }

  exportOf(file, name) {
    return modules.exportOf(this, file, name);
  }

  requireOf(file) {
    return modules.requireOf(this, file);
  }

  importValues(specifierPath) {
    return modules.importValues(this, specifierPath);
  }

  /** The app, router or plugin instance created by the code at `creationPath`, owned by `framework`. */
  router(framework, kind, creationPath) {
    return this.routers.at(framework, kind, creationPath);
  }

  /** Forgets memoized results, for indexes that resolved expressions while they were half-built (see indexCallers). */
  clearMemo() {
    this.memo.clear();
  }

  /** Call and new expressions that invoke a function (or a class, through its constructor). */
  callersOf(functionPath) {
    if (!this.callers) this.indexCallers();
    return this.callers.get(functionPath.node) || [];
  }

  // --- loops ------------------------------------------------------------------------------

  /**
   * Runs `fn` with a loop variable bound to one element, so `routes.forEach(r => app.use(r.path, r.router))`
   * pairs each path with its own router instead of every path with every router.
   */
  withLoopElement(variableNode, element, fn) {
    this.loopElements.set(variableNode, [element]);
    try {
      return fn();
    } finally {
      this.loopElements.delete(variableNode);
    }
  }

  loopElement(variableNode) {
    return this.loopElements.get(variableNode);
  }

  // --- cycle, depth and memo guard ----------------------------------------------------------

  /** Runs `compute` for `key` unless that would recurse into itself or too deep; then the answer is "unknown" ([]). */
  guard(key, compute) {
    if (this.inProgress.size >= MAX_DEPTH) {
      this.cycleCuts++;
      return [];
    }
    if (this.loopElements.size) return this.computeUncached(key, compute); // results differ per loop element
    if (this.memo.has(key)) return this.memo.get(key);
    if (this.provisional.has(key)) {
      this.cycleCuts++; // still partial: whatever is built on it is partial too
      return this.provisional.get(key);
    }
    if (this.inProgress.has(key)) {
      this.cycleCuts++;
      return [];
    }
    const cutsBefore = this.cycleCuts;
    this.inProgress.add(key);
    try {
      const values = compute();
      if (this.cycleCuts === cutsBefore) this.memo.set(key, values);
      else this.provisional.set(key, values);
      return values;
    } finally {
      this.inProgress.delete(key);
      if (!this.inProgress.size) this.provisional.clear(); // the outermost question is answered
    }
  }

  computeUncached(key, compute) {
    if (this.inProgress.has(key)) return [];
    this.inProgress.add(key);
    try {
      return compute();
    } finally {
      this.inProgress.delete(key);
    }
  }

  indexCallers() {
    // set before filling: resolving a callee may itself ask for callers, and then gets the partial index
    this.callers = new Map();
    for (const file of this.project.sourceFiles()) {
      for (const call of file.calls) {
        for (const callee of this.resolve(call.get('callee'))) {
          const target = calledFunction(callee, call);
          if (!target) continue;
          if (!this.callers.has(target)) this.callers.set(target, []);
          this.callers.get(target).push(call);
        }
      }
    }
    this.memo.clear(); // results cached while the index was half-built may miss call sites
  }
}

/** The function node a call runs: the function itself, or the constructor for `new SomeClass()`. */
function calledFunction(callee, call) {
  if (callee.kind === Kind.FUNCTION) return callee.declaration.node;
  if (callee.kind === Kind.CLASS && call.isNewExpression()) return constructorOf(callee.declaration)?.node;
  return null;
}

module.exports = { Resolver };
