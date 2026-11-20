'use strict';
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

/**
 * One source file of the project.
 *
 * Babel ASTs with their paths and scopes take about 70 bytes of memory per byte of source, too much to keep for
 * every file of a large monorepo. So a file is parsed once for a small summary (`imports`, `callSummaries`) and
 * the AST is dropped; it is parsed again, with paths, only when the analysis looks inside the file
 * (`program`, `calls`, `callAt`). Most files are never looked inside: the summaries tell which ones can matter.
 */
class SourceFile {
  /** Throws when the code cannot be parsed. `onParsed(file)` is called when the paths are built. */
  constructor(filePath, code, onParsed) {
    this.filePath = filePath;
    this.code = code;
    const { imports, calls, valueNames, exportedNames, ownExports, commonJsDefault } = summarize(parseSource(filePath, code));
    this.imports = imports; // [{ kind, source, specifiers: [{ imported, local }] }], see summarize
    this.callSummaries = calls; // [{ start, end, order, callee, method, object, special, args, notPath, onClass }], see callSummary
    this.valueNames = valueNames; // parameters and variables not initialized with a function: they can hold one
    this.exportedNames = exportedNames; // identifiers used in exports: `export { a }`, `export default [a, b]`, `module.exports = { a }`
    this.ownExports = ownExports; // names the file's own statements export ('default' too), not counting re-exports
    this.commonJsDefault = commonJsDefault; // `module.exports = ...` or `export = ...`: its members are exports too
    this.methodNames = new Set(calls.map((call) => call.method));
    this.onParsed = onParsed;
    this.parsed = null; // { program, calls, byRange } once looked inside
  }

  /** The Babel path of the whole file. */
  get program() {
    return this.paths().program;
  }

  /** Paths of every call and `new` expression, in traversal order. */
  get calls() {
    return this.paths().calls;
  }

  /** The path of a summarized call. */
  callAt(summary) {
    return this.paths().byRange.get(rangeKey(summary));
  }

  /** The import declaration specifier that binds `localName` in the file ({ imported, local }), or undefined. */
  importedBinding(localName) {
    if (!this.bindings) {
      this.bindings = new Map();
      for (const entry of this.imports) {
        if (entry.kind === 'import') for (const specifier of entry.specifiers) this.bindings.set(specifier.local, specifier);
      }
    }
    return this.bindings.get(localName);
  }

  /**
   * False when the file surely does not export `name`, judging from its summary: then looking it up does not need
   * the file's paths. A re-export (`export * from`) of the name or a `module.exports = ...` may export anything.
   */
  mayExport(name) {
    if (this.commonJsDefault || this.ownExports.has(name)) return true;
    return this.imports.some((entry) => entry.kind === 'reexport'
      && (entry.specifiers.length ? entry.specifiers.some((specifier) => specifier.local === name) : name !== 'default'));
  }

  /** True when the file calls `x.<name>(...)` somewhere. */
  callsMethod(name) {
    return this.methodNames.has(name);
  }

  paths() {
    if (!this.parsed) {
      const parsed = { program: null, calls: [], byRange: new Map() };
      traverse(parseSource(this.filePath, this.code), {
        Program(program) { parsed.program = program; },
        'CallExpression|NewExpression'(call) {
          parsed.calls.push(call);
          parsed.byRange.set(rangeKey(call.node), call);
        },
      });
      this.parsed = parsed;
      this.onParsed(this);
    }
    return this.parsed;
  }
}

// `a.b()()` has two calls starting at the same position, but they end at different ones
const rangeKey = ({ start, end }) => `${start}:${end}`;

function parseSource(filePath, code) {
  return parse(code, {
    sourceType: 'unambiguous',
    errorRecovery: true,
    allowReturnOutsideFunction: true,
    plugins: parserPlugins(filePath),
  });
}

function parserPlugins(filePath) {
  const typescript = /\.[cm]?tsx?$/.test(filePath);
  const jsx = !typescript || filePath.endsWith('x'); // .js files may contain JSX; in TypeScript only .tsx
  return ['decorators-legacy', ...(typescript ? ['typescript'] : []), ...(jsx ? ['jsx'] : [])];
}

const SKIPPED_KEYS = new Set(['loc', 'leadingComments', 'trailingComments', 'innerComments', 'extra']);

/**
 * Imports, calls and a few names of a file, from its bare AST (no paths, no scopes). Names ignore scopes: a name
 * is in valueNames if any declaration of it anywhere in the file can hold a value.
 *
 * imports, by kind:
 *   import    `import ... from 'x'`, with the names it binds: `imported` is the exported name, 'default' or '*'
 *   reexport  `export { a as b } from 'x'` ({ imported: 'a', local: 'b' }), `export * as ns from 'x'`
 *             ({ imported: '*', local: 'ns' }), `export * from 'x'` (no specifiers: every name passes through)
 *   load      `require('x')`, `import('x')`, `import x = require('x')`
 */
function summarize(ast) {
  const imports = [];
  const calls = [];
  const classDecorators = new Set(); // call nodes of `@Decorator(...)` on a class
  const valueNames = new Set();
  const exportedNames = new Set();
  const superclasses = []; // name of the superclass of each class around the node being visited, see callSummary
  const visit = (node) => {
    if (FUNCTION_TYPES.has(node.type) && node.params) for (const param of node.params) addPatternNames(param, valueNames);
    switch (node.type) {
      case 'ImportDeclaration':
        imports.push({ kind: 'import', source: node.source.value, specifiers: node.specifiers.map(importedName) });
        break;
      case 'ExportNamedDeclaration':
        if (node.source) imports.push({ kind: 'reexport', source: node.source.value, specifiers: node.specifiers.map(reexportedName) });
        else for (const specifier of node.specifiers) exportedNames.add(nameOf(specifier.local));
        for (const declarator of node.declaration?.declarations || []) addExpressionNames(declarator.init, exportedNames);
        break;
      case 'ExportDefaultDeclaration':
        addExpressionNames(node.declaration, exportedNames);
        break;
      case 'TSExportAssignment':
        addExpressionNames(node.expression, exportedNames);
        break;
      case 'VariableDeclarator':
        if (!(node.id.type === 'Identifier' && node.init && FUNCTION_TYPES.has(node.init.type))) addPatternNames(node.id, valueNames);
        break;
      case 'CatchClause':
        if (node.param) addPatternNames(node.param, valueNames);
        break;
      case 'AssignmentExpression':
        if (node.left.type === 'Identifier') valueNames.add(node.left.name);
        if (isExportTarget(node.left)) addExpressionNames(node.right, exportedNames);
        break;
      case 'ExportAllDeclaration':
        imports.push({ kind: 'reexport', source: node.source.value, specifiers: [] });
        break;
      case 'TSImportEqualsDeclaration':
        if (node.moduleReference.type === 'TSExternalModuleReference') imports.push({ kind: 'load', source: node.moduleReference.expression.value, specifiers: [] });
        break;
      case 'ClassDeclaration':
      case 'ClassExpression':
        for (const decorator of node.decorators || []) classDecorators.add(decorator.expression);
        break;
      case 'CallExpression':
      case 'NewExpression': {
        calls.push(callSummary(node, classDecorators.has(node), superclasses[superclasses.length - 1]));
        const loaded = node.arguments[0];
        const loads = node.callee.type === 'Import' || (node.callee.type === 'Identifier' && node.callee.name === 'require');
        if (loads && loaded && loaded.type === 'StringLiteral') imports.push({ kind: 'load', source: loaded.value, specifiers: [] });
        break;
      }
    }
    const isClass = node.type === 'ClassDeclaration' || node.type === 'ClassExpression';
    if (isClass) superclasses.push(superclassName(node.superClass));
    for (const key in node) {
      if (SKIPPED_KEYS.has(key)) continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const element of child) if (element && typeof element.type === 'string') visit(element);
      } else if (child && typeof child.type === 'string') {
        visit(child);
      }
    }
    if (isClass) superclasses.pop();
  };
  visit(ast.program);
  return { imports, calls, valueNames, exportedNames, ...topLevelExports(ast.program) };
}

/** Names exported by the file's own top-level statements, as modules.js finds them (see exportedBy there). */
function topLevelExports(program) {
  const ownExports = new Set();
  let commonJsDefault = false;
  for (const statement of program.body) {
    if (statement.type === 'ExportDefaultDeclaration') ownExports.add('default');
    else if (statement.type === 'TSExportAssignment') commonJsDefault = true;
    else if (statement.type === 'ExportNamedDeclaration' && !statement.source) {
      const declaration = statement.declaration;
      if (declaration && declaration.id) ownExports.add(declaration.id.name);
      for (const declarator of declaration?.declarations || []) if (declarator.id.type === 'Identifier') ownExports.add(declarator.id.name);
      for (const specifier of statement.specifiers) ownExports.add(nameOf(specifier.exported));
    } else if (statement.type === 'ExpressionStatement' && statement.expression.type === 'AssignmentExpression') {
      const target = statement.expression.left;
      if (isModuleExportsNode(target)) commonJsDefault = true;
      else if (target.type === 'MemberExpression' && (isModuleExportsNode(target.object) || (target.object.type === 'Identifier' && target.object.name === 'exports'))) {
        const name = target.computed ? target.property.value : target.property.name;
        if (name) ownExports.add(name);
      }
    }
  }
  return { ownExports, commonJsDefault };
}

const isModuleExportsNode = (node) => node.type === 'MemberExpression' && node.object.type === 'Identifier'
  && node.object.name === 'module' && !node.computed && node.property.name === 'exports';

// functions and classes: what a variable initialized with one holds is not a value passed in
const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod',
  'ClassMethod', 'ClassPrivateMethod', 'ClassExpression', 'ClassDeclaration']);

/** `module.exports`, `module.exports.x`, `exports.x` */
const isExportTarget = (node) => node.type === 'MemberExpression'
  && ((node.object.type === 'Identifier' && (node.object.name === 'exports' || (node.object.name === 'module' && node.property.name === 'exports')))
    || isExportTarget(node.object));

/** Identifiers bound by a parameter or declaration pattern: `a`, `{ a, b: [c] }`, `...d`, `e = 1` */
function addPatternNames(pattern, names) {
  if (!pattern) return;
  if (pattern.type === 'Identifier') names.add(pattern.name);
  else if (pattern.type === 'ObjectPattern') for (const property of pattern.properties) addPatternNames(property.value || property.argument, names);
  else if (pattern.type === 'ArrayPattern') for (const element of pattern.elements) addPatternNames(element, names);
  else if (pattern.type === 'RestElement') addPatternNames(pattern.argument, names);
  else if (pattern.type === 'AssignmentPattern') addPatternNames(pattern.left, names);
  else if (pattern.type === 'TSParameterProperty') addPatternNames(pattern.parameter, names);
}

/** Identifiers an exported expression is built from (`[a, b]`, `{ a, b: c }`, `f(a)`), not looking into functions. */
function addExpressionNames(node, names) {
  if (!node || typeof node.type !== 'string' || FUNCTION_TYPES.has(node.type)) return;
  if (node.type === 'Identifier') {
    names.add(node.name);
    return;
  }
  for (const key in node) {
    if (SKIPPED_KEYS.has(key)) continue;
    const child = node[key];
    if (Array.isArray(child)) for (const element of child) addExpressionNames(element, names);
    else if (child && typeof child.type === 'string') addExpressionNames(child, names);
  }
}

const nameOf = (node) => node.name ?? node.value;

const importedName = (specifier) => ({
  imported: specifier.type === 'ImportSpecifier' ? nameOf(specifier.imported)
    : specifier.type === 'ImportDefaultSpecifier' ? 'default' : '*',
  local: specifier.local.name,
});

const reexportedName = (specifier) => ({
  imported: specifier.type === 'ExportNamespaceSpecifier' ? '*' : nameOf(specifier.local),
  local: nameOf(specifier.exported),
});

/** `extends Base` -> 'Base', `extends ns.Base` -> 'Base', `extends Mixin(Base)` -> 'Mixin'; null when unknown. */
function superclassName(node) {
  while (node && (node.type === 'CallExpression' || node.type === 'TSNonNullExpression')) node = node.callee || node.expression;
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  return node.type === 'MemberExpression' && !node.computed ? node.property.name : null;
}

/**
 * What can be told about a call without resolving anything: `callee` is the name of an identifier callee (`f()`)
 * or, for `super()`, of the superclass,
 * `method` the property of a member callee (`x.get()`) and `object` the node type of its object ('Super' for
 * `super.get()`), `special` 'super' or 'import' for `super()` and `import()`, `order` where the method name starts
 * (source order of chained calls), `notPath` whether the first argument is a string that cannot be a route path
 * (`config.get('port', 80)`, `db.query('SELECT ...', [])`), `onClass` whether it is a class decorator.
 */
function callSummary(node, onClass, superclass) {
  const callee = node.callee;
  const member = callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression';
  const property = member && (!callee.computed || callee.property.type === 'StringLiteral') ? callee.property : null;
  return {
    start: node.start,
    end: node.end,
    order: property ? property.start : node.start,
    callee: callee.type === 'Identifier' ? callee.name : callee.type === 'Super' ? superclass ?? null : null,
    method: property ? property.name ?? property.value : null,
    object: member ? callee.object.type : null,
    special: callee.type === 'Super' ? 'super' : callee.type === 'Import' ? 'import' : null,
    args: node.arguments.length,
    notPath: !mayBePath(node.arguments[0]),
    onClass,
  };
}

/** False for a string that cannot be a route path: paths start with '/' or '*', or are '' (a plugin's prefix itself). */
function mayBePath(node) {
  const text = node?.type === 'StringLiteral' ? node.value : node?.type === 'TemplateLiteral' ? node.quasis[0].value.cooked : null;
  return text === null || text === '' || /^[/*]/.test(text);
}

module.exports = { SourceFile };
