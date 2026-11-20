'use strict';
const path = require('path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { SOURCE_EXTENSIONS } = require('./files');
const { PathAliases } = require('./pathAliases');

/**
 * The parsed source files of the analyzed project and how they import each other.
 *
 * A SourceFile is { filePath, code, program, calls }: `program` is the Babel path of the whole file and
 * `calls` every call and `new` expression in it, which is where routes, mounts and routers come from.
 */
class Project {
  constructor(root) {
    this.root = root;
    this.files = new Map(); // absolute path -> SourceFile
    this.fileByProgram = new Map(); // Babel Program node -> SourceFile
    this.warnings = [];
    this.aliases = new PathAliases((file, error) => this.warn(`could not read ${this.relative(file)}: ${error.message}`));
  }

  warn(message) {
    this.warnings.push(`warning: ${message}`);
  }

  relative(filePath) {
    return path.relative(this.root, filePath);
  }

  /** Parses a source file. A file that cannot be parsed is skipped with a warning. */
  addSource(filePath, code) {
    try {
      const ast = parse(code, {
        sourceType: 'unambiguous',
        errorRecovery: true,
        allowReturnOutsideFunction: true,
        plugins: parserPlugins(filePath),
      });
      const file = { filePath, code, program: null, calls: [] };
      traverse(ast, {
        Program(program) { file.program = program; },
        'CallExpression|NewExpression'(call) { file.calls.push(call); },
      });
      this.files.set(filePath, file);
      this.fileByProgram.set(file.program.node, file);
    } catch (error) {
      this.warn(`could not parse ${this.relative(filePath)}: ${error.message}`);
    }
  }

  sourceFiles() {
    return this.files.values();
  }

  /** The SourceFile a Babel path belongs to. */
  fileOf(nodePath) {
    return this.fileByProgram.get(nodePath.scope.getProgramParent().path.node);
  }

  /** The source code of a Babel path, as written. */
  sourceText(nodePath) {
    return this.fileOf(nodePath).code.slice(nodePath.node.start, nodePath.node.end);
  }

  /** "relative/file.ts:12" */
  location(nodePath) {
    return `${this.relative(this.fileOf(nodePath).filePath)}:${nodePath.node.loc.start.line}`;
  }

  /** The project file an import specifier points to, or null (npm packages, files outside the project). */
  resolveImport(fromFile, specifier) {
    if (specifier.startsWith('.') || path.isAbsolute(specifier)) return this.fileAt(path.resolve(path.dirname(fromFile), specifier));
    for (const candidate of this.aliases.candidates(path.dirname(fromFile), specifier)) {
      const file = this.fileAt(candidate);
      if (file) return file;
    }
    return null;
  }

  /** Node's and TypeScript's lookup: exact file, added extension, then index file. */
  fileAt(base) {
    const withoutJs = base.replace(/\.[cm]?jsx?$/, ''); // TypeScript ESM imports './x.js' for x.ts
    const candidates = [
      base,
      ...SOURCE_EXTENSIONS.map((extension) => withoutJs + extension),
      ...SOURCE_EXTENSIONS.map((extension) => path.join(base, 'index' + extension)),
    ];
    for (const candidate of candidates) {
      if (this.files.has(candidate)) return this.files.get(candidate);
    }
    return null;
  }
}

function parserPlugins(filePath) {
  const typescript = /\.[cm]?tsx?$/.test(filePath);
  const jsx = !typescript || filePath.endsWith('x'); // .js files may contain JSX; in TypeScript only .tsx
  return ['decorators-legacy', ...(typescript ? ['typescript'] : []), ...(jsx ? ['jsx'] : [])];
}

module.exports = { Project };
