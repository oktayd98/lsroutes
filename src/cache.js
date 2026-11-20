'use strict';
/**
 * Result cache in the OS temp directory, one file per scanned directory.
 *
 * The key hashes lsroutes' own source and every scanned file's path and content, so editing, adding or
 * removing a file, changing a tsconfig alias or upgrading lsroutes invalidates it. Reading and hashing the
 * files is about 25x cheaper than parsing and analyzing them.
 * shortcut: tsconfigs outside the scanned directory (parent directory, `extends` from a package) are not part of the key; hash them if that bites
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const sha1 = () => crypto.createHash('sha1');
const CACHE_DIR = path.join(os.tmpdir(), 'lsroutes');
const TOOL_DIRS = ['bin', 'src'].map((dir) => path.join(__dirname, '..', dir));

function cacheKey(filePaths, contents) {
  const hash = sha1();
  for (const toolFile of toolSourceFiles()) hash.update(fs.readFileSync(toolFile));
  filePaths.forEach((filePath, i) => hash.update(`\0${filePath}\0`).update(contents[i]));
  return hash.digest('hex');
}

function readCache(root, key) {
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile(root), 'utf8'));
    return cached.key === key ? cached.result : null;
  } catch {
    return null; // missing or corrupt cache: analyze again
  }
}

function writeCache(root, key, result) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile(root), JSON.stringify({ key, result }));
  } catch {} // the cache is an optimization: a read-only temp directory must not fail the command
}

const cacheFile = (root) => path.join(CACHE_DIR, sha1().update(root).digest('hex') + '.json');

function toolSourceFiles(dirs = TOOL_DIRS, found = []) {
  for (const dir of dirs) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) toolSourceFiles([fullPath], found);
      else if (entry.name.endsWith('.js')) found.push(fullPath);
    }
  }
  return found;
}

module.exports = { cacheKey, readCache, writeCache };
