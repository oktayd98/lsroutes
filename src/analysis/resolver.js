'use strict';
const { Kind } = require('./values');
const { RouterRegistry } = require('./routers');
const { constructorOf, callableNames } = require('./ast');
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
    this.callers = new Map(); // function node -> call and new expressions invoking it, for the calls indexed so far
    this.indexedCalls = new Set(); // call summaries whose callee is resolved into `callers`, or queued for it
    this.callsToIndex = []; // [file, call summary], see callersOf
    this.indexing = false;
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

  /** Forgets memoized results, for indexes that resolved expressions while they were half-built (see callersOf). */
  clearMemo() {
    this.memo.clear();
  }

  /**
   * Call and new expressions that invoke a function (or a class, through its constructor).
   *
   * Resolving every call of a large project would parse every file, so only calls that can reach the function
   * are resolved, judged from the file summaries (see SourceFile):
   * - in the function's own file and the files it is passed on to by imports (Project.importersOf) that import it:
   *   by one of its names, as a namespace or with require(); a file importing only other names of a barrel cannot;
   * - `x.name(...)` only when `name` is one of the function's names (callableNames), also as renamed by barrels;
   * - `name(...)` with an imported `name` only when it imports one of those names; with a local `name` when that is
   *   one of the names or, for a function that is not a method, a parameter or variable, which can hold it
   *   (`const routes = require('./routes')`); never a global or another local function;
   * - `super(...)` only for a constructor, in a class extending one of the names; `import(...)` never; other callees
   *   (`require('./routes')(app)`) always.
   * shortcut: a function passed as a value into a file that does not import it (`mountAll(app, [routes])` calling
   * `routes(app)` in a helper file) is not followed; index the helper's importers too if real projects need it.
   */
  callersOf(functionPath) {
    const file = this.project.fileOf(functionPath);
    const importers = this.project.importersOf(file);
    const names = reexportedNames(importers.keys(), callableNames(functionPath));
    const byValue = !isMember(functionPath); // methods and constructors are called as `x.name()`, `new C()`, `super()`
    for (const [importer, entries] of importers) {
      if (importer !== file && !entries.some((entry) => importsOneOf(entry, names))) continue;
      for (const call of importer.callSummaries) {
        if (this.indexedCalls.has(call) || !mayCall(importer, call, names, byValue)) continue;
        this.indexedCalls.add(call);
        this.callsToIndex.push([importer, call]);
      }
    }
    if (!this.indexing) this.indexQueuedCalls(); // while indexing, the asker gets the partial index, as below
    return this.callers.get(functionPath.node) || [];
  }

  /**
   * Indexing does not depend on the question that asked for it, so it runs on a stack of its own: inside a deep
   * question, MAX_DEPTH would cut the callees and leave the index incomplete for good. Calls queued meanwhile are
   * indexed in the same loop, never on a stack of their own: the stack stays at most two MAX_DEPTHs deep.
   */
  indexQueuedCalls() {
    if (!this.callsToIndex.length) return;
    const outerQuestions = this.inProgress;
    this.inProgress = new Set();
    this.indexing = true;
    try {
      while (this.callsToIndex.length) {
        const [file, summary] = this.callsToIndex.shift();
        const call = file.callAt(summary);
        if (call) this.indexCall(call);
      }
    } finally {
      this.inProgress = outerQuestions;
      this.indexing = false;
    }
    this.memo.clear(); // results cached while the index was half-built may miss call sites
  }

  indexCall(call) {
    for (const callee of this.resolve(call.get('callee'))) {
      const target = calledFunction(callee, call);
      if (!target) continue;
      if (!this.callers.has(target)) this.callers.set(target, []);
      this.callers.get(target).push(call);
    }
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
}

/** `names` plus what barrels among `files` re-export them as (`export { default as users } from './users'`). */
function reexportedNames(files, names) {
  files = [...files];
  let added = true;
  while (added) {
    added = false;
    for (const file of files) {
      for (const entry of file.imports) {
        if (entry.kind !== 'reexport') continue;
        for (const { imported, local } of entry.specifiers) {
          if (names.has(imported) && !names.has(local)) added = names.add(local);
        }
      }
    }
  }
  return names;
}

/**
 * Whether an import entry can bring in a function called `names`: by one of those names, as a namespace
 * (`import * as routes`), or as a whole module (`require('./routes')`). A re-export only passes it on.
 */
const importsOneOf = (entry, names) => entry.kind === 'load'
  || (entry.kind === 'import' && entry.specifiers.some(({ imported }) => imported === '*' || names.has(imported)));

/** Whether a summarized call can invoke a function called `names`, see callersOf. */
function mayCall(file, call, names, byValue) {
  if (call.special === 'super') return names.has('constructor') && (call.callee === null || calls(file, call.callee, names, false));
  if (call.special) return false; // import()
  if (call.method !== null) return names.has(call.method);
  return call.callee === null || calls(file, call.callee, names, byValue);
}

/**
 * Whether `name` in a file can be a function called `names`: an import of one of them, a local of one of those
 * names, or (byValue) a parameter or variable, which can hold any function.
 */
function calls(file, name, names, byValue) {
  const binding = file.importedBinding(name);
  if (binding) return names.has(binding.imported);
  return names.has(name) || (byValue && file.valueNames.has(name));
}

/** A class method or constructor, or a method of an object literal (also `{ name: () => ... }`). */
const isMember = (functionPath) => functionPath.isClassMethod() || functionPath.isClassPrivateMethod() || functionPath.isObjectMethod()
  || functionPath.parentPath.isObjectProperty({ value: functionPath.node }) || functionPath.parentPath.isClassProperty({ value: functionPath.node });

/** The function node a call runs: the function itself, or the constructor for `new SomeClass()`. */
function calledFunction(callee, call) {
  if (callee.kind === Kind.FUNCTION) return callee.declaration.node;
  if (callee.kind === Kind.CLASS && call.isNewExpression()) return constructorOf(callee.declaration)?.node;
  return null;
}

module.exports = { Resolver };
