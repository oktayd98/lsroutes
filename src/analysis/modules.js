'use strict';
// Rules: what imports, require() calls and exports of project files evaluate to (ESM, CommonJS and TypeScript).
const { Value } = require('./values');
const { nameOf, propertyName, isModuleExports } = require('./ast');

/** `import x from`, `import { x } from`, `import * as x from`: a framework package or a project file's export. */
function importValues(resolver, specifier) {
  const source = specifier.parent.source.value;
  const importedName = specifier.isImportSpecifier() ? nameOf(specifier.node.imported) : null;
  const frameworkPackage = resolver.frameworks.packageValue(source);
  if (frameworkPackage) return importedName ? resolver.member([frameworkPackage], importedName) : [frameworkPackage];
  const file = resolver.project.resolveImport(resolver.project.fileOf(specifier).filePath, source);
  if (!file) return [];
  if (specifier.isImportNamespaceSpecifier()) return [Value.module(file)];
  if (importedName) return exportOf(resolver, file, importedName);
  const defaultExport = exportOf(resolver, file, 'default');
  return defaultExport.length ? defaultExport : [Value.module(file)]; // default import of a CommonJS file with exports.x
}

/** require('./file'): its `module.exports = ...` value, or the file as a namespace of `exports.x`. */
function requireOf(resolver, file) {
  return hasCommonJsDefault(file) ? exportOf(resolver, file, 'default') : [Value.module(file)];
}

const hasCommonJsDefault = (file) => file.commonJsDefault; // `module.exports = ...` or `export = ...`, see SourceFile

/**
 * Values a file exports under `name` ('default' for the default export), following re-exports. Files that do not
 * export the name are ruled out from their summary, so a barrel of 100 `export * from` lines does not parse 100 files.
 */
function exportOf(resolver, file, name) {
  if (!file.mayExport(name)) return [];
  return resolver.guard(`${file.filePath}#${name}`, () =>
    file.program.get('body').flatMap((statement) => exportedBy(resolver, file, statement, name)));
}

function exportedBy(resolver, file, statement, name) {
  if (statement.isExportDefaultDeclaration() || statement.isTSExportAssignment()) {
    if (name !== 'default') return [];
    return resolver.resolve(statement.get(statement.isTSExportAssignment() ? 'expression' : 'declaration'));
  }
  if (statement.isExportNamedDeclaration()) return namedExport(resolver, file, statement, name);
  if (statement.isExportAllDeclaration()) {
    const from = resolver.project.resolveImport(file.filePath, statement.node.source.value);
    return from && name !== 'default' ? exportOf(resolver, from, name) : [];
  }
  if (statement.isExpressionStatement() && statement.get('expression').isAssignmentExpression()) {
    return commonJsExport(resolver, statement.get('expression'), name);
  }
  return [];
}

/** `export const x = ...`, `export function x`, `export { a as x }`, `export { x } from './y'`, `export * as x from './y'` */
function namedExport(resolver, file, statement, name) {
  const values = [];
  const declaration = statement.get('declaration');
  if (declaration.isVariableDeclaration()) {
    for (const declarator of declaration.get('declarations')) {
      if (declarator.node.id.name === name) values.push(...resolver.resolve(declarator.get('init')));
    }
  } else if (declaration.node && declaration.node.id && declaration.node.id.name === name) {
    values.push(...resolver.resolve(declaration));
  }
  const source = statement.node.source;
  const from = source && resolver.project.resolveImport(file.filePath, source.value);
  for (const specifier of statement.get('specifiers')) {
    if (nameOf(specifier.node.exported) !== name) continue;
    if (specifier.isExportNamespaceSpecifier()) {
      if (from) values.push(Value.module(from));
    } else if (source) {
      if (from) values.push(...exportOf(resolver, from, nameOf(specifier.node.local)));
    } else {
      values.push(...resolver.resolve(specifier.get('local')));
    }
  }
  return values;
}

/** `module.exports = x`, `module.exports = { x }`, `module.exports.x = ...`, `exports.x = ...` */
function commonJsExport(resolver, assignment, name) {
  const target = assignment.node.left;
  if (isModuleExports(target)) {
    const exported = resolver.resolve(assignment.get('right'));
    return name === 'default' ? exported : resolver.member(exported, name);
  }
  const isNamedExport = target.type === 'MemberExpression' && (isModuleExports(target.object) || target.object.name === 'exports');
  return isNamedExport && propertyName(assignment.get('left')) === name ? resolver.resolve(assignment.get('right')) : [];
}

module.exports = { importValues, requireOf, exportOf };
