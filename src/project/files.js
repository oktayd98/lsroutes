'use strict';
const fs = require('fs');
const path = require('path');

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

// dependencies, build output and tests (tests often create throwaway apps)
const SKIPPED_DIRECTORIES = new Set([
  'node_modules', 'bower_components', 'jspm_packages', 'vendor', 'dist', 'build', 'coverage', 'out', '__tests__', 'test', 'tests',
]);
// test files, type declarations and minified bundles
const SKIPPED_FILES = /\.(test|spec)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$|\.min\.[cm]?js$/;
const CONFIG_FILE = /^[tj]sconfig(\..+)?\.json$/;

const isSourceFile = (name) => SOURCE_EXTENSIONS.includes(path.extname(name)) && !SKIPPED_FILES.test(name);
const isConfigFile = (name) => CONFIG_FILE.test(name);

/**
 * Source files and tsconfig/jsconfig files under `dir`. Hidden, dependency, build and test directories
 * are skipped. Sorted, so the output order does not depend on the file system's readdir order.
 */
function findProjectFiles(dir, found = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) findProjectFiles(fullPath, found);
    else if (isSourceFile(entry.name) || isConfigFile(entry.name)) found.push(fullPath);
  }
  return found;
}

module.exports = { SOURCE_EXTENSIONS, findProjectFiles, isConfigFile };
