'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Import aliases from tsconfig.json / jsconfig.json (`paths` and `baseUrl`), read from the nearest config
 * up the directory tree, like the TypeScript language service does.
 */
class PathAliases {
  /** @param {(file: string, error: Error) => void} onUnreadableConfig */
  constructor(onUnreadableConfig) {
    this.onUnreadableConfig = onUnreadableConfig;
    this.configByDir = new Map(); // directory -> effective config { baseUrl, paths, pathsDir }
  }

  /** Absolute paths a non-relative `specifier` imported from a file in `fromDir` may point to, in TypeScript's order. */
  candidates(fromDir, specifier) {
    return aliasTargets(this.configFor(fromDir), specifier);
  }

  configFor(dir) {
    if (!this.configByDir.has(dir)) {
      const file = ['tsconfig.json', 'jsconfig.json'].map((name) => path.join(dir, name)).find((f) => fs.existsSync(f));
      const parent = path.dirname(dir);
      const isRoot = parent === dir;
      this.configByDir.set(dir, file ? this.load(file) : isRoot ? {} : this.configFor(parent));
    }
    return this.configByDir.get(dir);
  }

  /** Effective { baseUrl, paths, pathsDir } of a config after following `extends` (string or array, relative or package). */
  load(file, seen = new Set()) {
    if (seen.has(file)) return {};
    seen.add(file);
    let json;
    try {
      json = parseJsonc(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      this.onUnreadableConfig(file, error);
      return {};
    }
    const dir = path.dirname(file);
    let config = {};
    for (const parent of [].concat(json.extends || [])) {
      const parentFile = findExtendedConfig(parent, dir);
      if (parentFile) config = { ...config, ...this.load(parentFile, seen) };
    }
    const options = json.compilerOptions || {};
    if (options.baseUrl != null) config.baseUrl = path.resolve(dir, options.baseUrl);
    // without baseUrl, `paths` are relative to the config that declares them
    if (options.paths) Object.assign(config, { paths: options.paths, pathsDir: dir });
    return config;
  }
}

// tsconfig is JSONC: drop comments and trailing commas, leaving string contents ("https://...") alone
const parseJsonc = (text) =>
  JSON.parse(text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\/|,(?=\s*[}\]])/g, (match, string) => string ?? ''));

/** `extends` may omit `.json` and may name a file inside a package. */
function findExtendedConfig(reference, dir) {
  return [reference, reference + '.json']
    .map((candidate) => (candidate.startsWith('.') || path.isAbsolute(candidate) ? path.resolve(dir, candidate) : resolvePackageFile(candidate, dir)))
    .find((file) => file && fs.existsSync(file) && fs.statSync(file).isFile());
}

function resolvePackageFile(request, dir) {
  try {
    return require.resolve(request, { paths: [dir] });
  } catch {
    return null;
  }
}

/**
 * TypeScript's rules: an exact `paths` key wins, otherwise the pattern with the longest prefix before `*`.
 * Its targets are tried in order, then `baseUrl/specifier`.
 */
function aliasTargets(config, specifier) {
  let best = null;
  let wildcard = '';
  for (const key of Object.keys(config.paths || {})) {
    const star = key.indexOf('*');
    if (star < 0) {
      if (key === specifier) {
        best = key;
        wildcard = '';
        break;
      }
      continue;
    }
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    const matches = specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix) && specifier.endsWith(suffix);
    if (matches && (!best || prefix.length > best.indexOf('*'))) {
      best = key;
      wildcard = specifier.slice(prefix.length, specifier.length - suffix.length);
    }
  }
  const targets = [];
  if (best) {
    for (const target of [].concat(config.paths[best])) targets.push(path.resolve(config.baseUrl ?? config.pathsDir, target.replace('*', wildcard)));
  }
  if (config.baseUrl) targets.push(path.resolve(config.baseUrl, specifier));
  return targets;
}

module.exports = { PathAliases, aliasTargets, parseJsonc };
