'use strict';
const path = require('path');
const { SOURCE_EXTENSIONS } = require('./files');
const { PathAliases } = require('./pathAliases');
const { SourceFile } = require('./sourceFile');

/**
 * The source files of the analyzed project (see sourceFile.js) and how they import each other.
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

  /** Adds a source file. A file that cannot be parsed is skipped with a warning. */
  addSource(filePath, code) {
    try {
      this.files.set(filePath, new SourceFile(filePath, code, (file) => this.fileByProgram.set(file.program.node, file)));
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

  /**
   * The file and the files that can refer to what it defines: the files importing it, and in turn the files
   * importing those that pass it on: re-export it (`export * from`), load it with require() or import(), or export
   * a name they import from it (`import users from './users'; export default [users]`). Short of a value passed
   * along at runtime, nothing else can reach the file's functions.
   * @returns {Map<SourceFile, object[]>} each file found, with its import entries (see SourceFile) of files found
   */
  importersOf(file) {
    if (!this.importedBy) this.indexImports();
    const found = new Map([[file, []]]); // file -> its import entries of the files found
    const passers = new Set([file]);
    const passingOn = [file];
    while (passingOn.length) {
      for (const { importer, entry } of this.importedBy.get(passingOn.pop()) || []) {
        if (!found.has(importer)) found.set(importer, []);
        found.get(importer).push(entry);
        if (!passers.has(importer) && passesOn(importer, entry)) {
          passers.add(importer);
          passingOn.push(importer);
        }
      }
    }
    return found;
  }

  indexImports() {
    this.importedBy = new Map(); // SourceFile -> [{ importer: SourceFile, entry: the importer's import entry }]
    for (const file of this.files.values()) {
      for (const entry of file.imports) {
        const imported = this.resolveImport(file.filePath, entry.source);
        if (!imported || imported === file) continue;
        if (!this.importedBy.has(imported)) this.importedBy.set(imported, []);
        this.importedBy.get(imported).push({ importer: file, entry });
      }
    }
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

/** Whether a file passes on what it imports with `entry`, see importersOf. */
const passesOn = (file, entry) => entry.kind !== 'import' || entry.specifiers.some((specifier) => file.exportedNames.has(specifier.local));

module.exports = { Project };
