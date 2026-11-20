'use strict';
/**
 * Fastify: `fastify()` instances, shorthand routes (`fastify.get(path, [options], handler)`), full declarations
 * (`fastify.route({ method, url, handler })`) and plugins (`fastify.register(plugin, { prefix })`).
 *
 * A plugin is a function whose first parameter is a new child instance (encapsulation); routes it declares
 * on that parameter get the plugin's prefix. Plugins wrapped with fastify-plugin (`fp(plugin)`) are not
 * encapsulated, so the prefix option does not apply to them. @fastify/autoload registers every plugin file
 * of a directory, with prefixes from the directory structure (rules: see autoloadedPlugins).
 */
const path = require('path');
const { Framework } = require('./framework');
const { ROUTE_METHODS } = require('./httpMethods');
const { Kind, Value } = require('../analysis/values');
const { propertyName } = require('../analysis/ast');
const { optionPath, stringOption } = require('./options');

const FASTIFY = Value.framework('fastify', 'fastify'); // the module: fastify() creates an instance
const PLUGIN_WRAPPER = Value.framework('fastify', 'fastify-plugin'); // fp(plugin): a plugin without encapsulation
const AUTOLOAD = Value.framework('fastify', 'autoload'); // @fastify/autoload: registers a directory of plugins
const sharedPlugin = (declaration) => Value.framework('fastify', 'sharedPlugin', { declaration }); // the result of fp(plugin)

// instance methods that return the instance, so `fastify({...}).withTypeProvider()` is still the instance
const INSTANCE_METHODS = [
  'register', 'route', 'after', 'addHook', 'addSchema', 'addContentTypeParser', 'decorate', 'decorateRequest',
  'decorateReply', 'setErrorHandler', 'setNotFoundHandler', 'setValidatorCompiler', 'setSerializerCompiler',
  'setSchemaErrorFormatter', 'setReplySerializer', 'withTypeProvider',
];

// @fastify/autoload defaults (lib/find-plugins.js, index.js)
const AUTOLOAD_SCRIPT = /\.(?:[cm]?[jt]s)$/;
const AUTOLOAD_INDEX = /^index\.(?:[cm]?[jt]s)$/;
const AUTOLOAD_HOOKS = /^[_.]?auto_?hooks\.(?:[cm]?[jt]s)$/i;

class Fastify extends Framework {
  constructor() {
    super('fastify');
    this.packages = ['fastify', 'fastify-plugin', '@fastify/autoload', 'fastify-autoload'];
    this.chainedMethods = new Set([...ROUTE_METHODS, ...INSTANCE_METHODS]);
    this.collectedMethods = new Set([...ROUTE_METHODS, 'route', 'register']);
    this.plugins = null; // nodes of every function registered as a plugin, built on first use
    this.warnedCalls = new Set(); // register() calls already warned about
  }

  packageValue(packageName) {
    if (packageName === 'fastify') return FASTIFY;
    return packageName === 'fastify-plugin' ? PLUGIN_WRAPPER : AUTOLOAD;
  }

  /** `import { fastify } from 'fastify'`, `require('fastify').default`, `require('fastify-plugin').default` */
  member(resolver, value, name) {
    if (value.symbol === 'fastify' && (name === 'fastify' || name === 'default')) return [value];
    if ((value.symbol === 'fastify-plugin' || value.symbol === 'autoload') && name === 'default') return [value];
    return [];
  }

  call(resolver, value, callPath) {
    if (value.symbol === 'fastify') return [Value.router(resolver.router('fastify', 'app', callPath))];
    if (value.symbol === 'fastify-plugin') {
      return resolver.resolve(callPath.get('arguments.0'))
        .filter((plugin) => plugin.kind === Kind.FUNCTION)
        .map((plugin) => sharedPlugin(plugin.declaration));
    }
    return [];
  }

  methodResult(resolver, receiver) {
    return receiver.kind === Kind.ROUTER ? [receiver] : [];
  }

  /** The first parameter of a registered plugin is the plugin's own instance. */
  parameterValues(resolver, functionPath, index) {
    if (index !== 0 || !this.pluginFunctions(resolver).has(functionPath.node)) return [];
    return [Value.router(resolver.router('fastify', 'plugin', functionPath))];
  }

  /** register(plugin) and route(options) take one argument; shorthand routes a path ('' or '/...') and a handler. */
  mayCollect(call) {
    return call.method === 'register' || call.method === 'route' ? call.args >= 1 : call.args >= 2 && !call.notPath;
  }

  collectCall(context, targets, method, callPath) {
    const instances = targets.filter((target) => target.kind === Kind.ROUTER).map((target) => target.router);
    if (method === 'register') this.collectPlugins(context, instances, callPath);
    else if (method === 'route') collectRouteDeclarations(context, instances, callPath);
    else collectShorthandRoute(context, instances, method, callPath);
  }

  collectPlugins(context, instances, callPath) {
    for (const plugin of this.registeredPlugins(context.resolver, callPath)) {
      const child = context.resolver.router('fastify', 'plugin', plugin.declaration);
      for (const instance of instances) {
        for (const prefix of plugin.prefixes) if (child !== instance) instance.mount(child, prefix);
      }
    }
  }

  /** Every function passed to a `.register()` call, so their first parameter can be resolved to an instance. */
  pluginFunctions(resolver) {
    if (!this.plugins) {
      this.plugins = new Set(); // set before filling: resolving a plugin argument may ask again and get the partial set
      let found = false;
      for (const file of resolver.project.sourceFiles()) {
        for (const summary of file.callSummaries) {
          if (summary.method !== 'register' || !summary.args) continue;
          const call = file.callAt(summary);
          if (!call || !call.isCallExpression()) continue;
          found = true;
          for (const plugin of this.registeredPlugins(resolver, call)) this.plugins.add(plugin.declaration.node);
        }
      }
      if (found) resolver.clearMemo(); // results cached while the set was half-built may have missed plugins
    }
    return this.plugins;
  }

  /** The plugins a `.register(plugin, options)` call registers: [{ declaration, prefixes }] */
  registeredPlugins(resolver, callPath) {
    const [pluginArg, optionsArg] = callPath.get('arguments');
    if (!pluginArg) return [];
    const options = optionsArg ? resolver.resolve(optionsArg).filter((value) => value.kind === Kind.OBJECT) : [];
    const prefixes = stringOption(resolver, options, 'prefix') ?? ['/'];
    return resolver.resolve(pluginArg).flatMap((value) => this.pluginsOf(resolver, value, prefixes, options, callPath));
  }

  pluginsOf(resolver, value, prefixes, options, callPath) {
    if (value.kind === Kind.FUNCTION) return [{ declaration: value.declaration, prefixes }];
    if (value.kind === Kind.MODULE) { // register(import('./routes.js'))
      return resolver.exportOf(value.file, 'default').flatMap((exported) => this.pluginsOf(resolver, exported, prefixes, options, callPath));
    }
    if (value.kind !== Kind.FRAMEWORK || value.framework !== 'fastify') return [];
    if (value.symbol === 'sharedPlugin') return [{ declaration: value.declaration, prefixes: ['/'] }]; // no encapsulation, no prefix
    if (value.symbol === 'autoload') return this.autoloadedPlugins(resolver, options, callPath);
    return [];
  }

  /**
   * The plugins @fastify/autoload registers for `register(autoload, { dir, options, ... })`, following its rules:
   * every script in `dir` and its subdirectories is a plugin, except autohooks files; a directory with an
   * index file contributes only that file (its subdirectories still load). The prefix of a plugin is
   * `options.prefix` + (the file's `autoPrefix` export, or its directory path), unless the file exports
   * `prefixOverride`. With `routeParams`, directories named `_id` become `:id`.
   */
  autoloadedPlugins(resolver, options, callPath) {
    const dirOption = optionPath(options, 'dir');
    const dir = dirOption && evaluatePath(resolver, dirOption);
    if (!dir) {
      this.warnOnce(resolver, callPath, `could not resolve the @fastify/autoload dir at ${resolver.project.location(callPath)}`);
      return [];
    }
    const pluginOptions = resolver.resolve(optionPath(options, 'options')).filter((value) => value.kind === Kind.OBJECT);
    const optionsPrefix = (stringOption(resolver, pluginOptions, 'prefix')?.[0] ?? '').replace(/\/$/, '');
    const dirNameRoutePrefix = booleanOption(options, 'dirNameRoutePrefix') !== false;
    const routeParams = booleanOption(options, 'routeParams') === true;
    const ignorePattern = regexOption(options, 'ignorePattern');

    return autoloadFiles(resolver.project, dir, ignorePattern).flatMap(({ file, directory }) => {
      const directoryPrefix = dirNameRoutePrefix && directory ? `/${directory}` : '';
      const autoPrefix = exportedString(resolver, file, 'autoPrefix');
      const prefixOverride = exportedString(resolver, file, 'prefixOverride');
      let prefix = optionsPrefix;
      const ownPrefix = autoPrefix ?? directoryPrefix;
      if (prefixOverride !== undefined) prefix = prefixOverride;
      else if (ownPrefix) prefix = optionsPrefix + ownPrefix.replace(/\/+/g, '/');
      if (routeParams) prefix = prefix.includes('__') ? prefix.replace(/__/g, ':') : prefix.replace(/\/_/g, '/:');
      return resolver.exportOf(file, 'default').flatMap((exported) => {
        if (exported.kind === Kind.FUNCTION) return [{ declaration: exported.declaration, prefixes: [prefix || '/'] }];
        if (exported.kind === Kind.FRAMEWORK && exported.symbol === 'sharedPlugin') return [{ declaration: exported.declaration, prefixes: ['/'] }];
        return [];
      });
    });
  }

  warnOnce(resolver, callPath, message) {
    if (this.warnedCalls.has(callPath.node)) return;
    this.warnedCalls.add(callPath.node);
    resolver.project.warn(message);
  }
}

// --- route declarations -------------------------------------------------------------------

/** `fastify.get(path, handler)`, `fastify.get(path, options, handler)`, `fastify.get(path, { handler })` */
function collectShorthandRoute(context, instances, method, callPath) {
  const args = callPath.get('arguments');
  if (args.length < 2) return;
  const { resolver } = context;
  const last = args[args.length - 1];
  const options = resolver.resolve(last).filter((value) => value.kind === Kind.OBJECT);
  const handlerOption = optionPath(options, 'handler');
  const handler = handlerOption ? context.describeHandler(handlerOption) : context.handlerOf(args);
  for (const routePath of resolver.routePaths(args[0]) || [resolver.placeholder(args[0])]) {
    for (const instance of instances) context.addRoute(instance, { method, path: routePath, handler, callPath });
  }
}

/** `fastify.route({ method: 'GET' | ['GET', 'HEAD'], url | path, handler })` */
function collectRouteDeclarations(context, instances, callPath) {
  const { resolver } = context;
  for (const declaration of resolver.resolve(callPath.get('arguments.0')).filter((value) => value.kind === Kind.OBJECT)) {
    const methods = stringOption(resolver, [declaration], 'method') ?? [];
    const urls = stringOption(resolver, [declaration], 'url') ?? stringOption(resolver, [declaration], 'path') ?? [];
    const handlerOption = optionPath([declaration], 'handler');
    const handler = handlerOption ? context.describeHandler(handlerOption) : '';
    for (const method of methods) {
      for (const url of urls) {
        for (const instance of instances) context.addRoute(instance, { method: method.toLowerCase(), path: url, handler, callPath });
      }
    }
  }
}

// --- options objects ------------------------------------------------------------------------

function booleanOption(objects, key) {
  const option = optionPath(objects, key);
  return option && option.isBooleanLiteral() ? option.node.value : undefined;
}

function regexOption(objects, key) {
  const option = optionPath(objects, key);
  if (option && option.isRegExpLiteral()) return new RegExp(option.node.pattern, option.node.flags);
  if (option && option.isStringLiteral()) return new RegExp(option.node.value);
  return null;
}

function exportedString(resolver, file, name) {
  return resolver.exportOf(file, name).find((value) => value.kind === Kind.STRING)?.value;
}

// --- @fastify/autoload ----------------------------------------------------------------------

/** The plugin files autoload loads from `dir`, with their directory relative to it ('' for `dir` itself). */
function autoloadFiles(project, dir, ignorePattern) {
  const byDirectory = new Map(); // relative directory -> file names
  for (const file of project.sourceFiles()) {
    if (!file.filePath.startsWith(dir + path.sep) || !AUTOLOAD_SCRIPT.test(file.filePath)) continue;
    const relative = path.relative(dir, file.filePath).split(path.sep).join('/');
    if (ignorePattern && ignoredByPattern(relative, ignorePattern)) continue;
    const directory = path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative);
    if (!byDirectory.has(directory)) byDirectory.set(directory, []);
    byDirectory.get(directory).push({ name: path.posix.basename(relative), file });
  }
  const found = [];
  for (const [directory, entries] of byDirectory) {
    const index = entries.find((entry) => AUTOLOAD_INDEX.test(entry.name));
    const loaded = index ? [index] : entries.filter((entry) => !AUTOLOAD_HOOKS.test(entry.name));
    for (const entry of loaded) found.push({ file: entry.file, directory });
  }
  return found;
}

/** autoload tests ignorePattern against every entry on the way down: each parent directory, then the file. */
function ignoredByPattern(relative, pattern) {
  const parts = relative.split('/');
  return parts.some((_, i) => pattern.test(parts.slice(0, i + 1).join('/')));
}

/**
 * The absolute path an expression evaluates to, for autoload's `dir`: `path.join(__dirname, 'routes')`,
 * `join(import.meta.dirname, 'routes')`, `fileURLToPath(new URL('./routes', import.meta.url))`, a constant
 * holding one of those. Null when unknown.
 */
function evaluatePath(resolver, expression) {
  const file = resolver.project.fileOf(expression).filePath;
  const evaluate = (p) => {
    if (p.isIdentifier({ name: '__dirname' })) return path.dirname(file);
    if (p.isIdentifier({ name: '__filename' })) return file;
    if (p.isMemberExpression() && p.get('object').isMetaProperty()) {
      const name = propertyName(p);
      if (name === 'dirname') return path.dirname(file);
      if (name === 'filename' || name === 'url') return file; // import.meta.url is read as the file it names
      return null;
    }
    if (p.isStringLiteral()) return p.node.value;
    if (p.isIdentifier()) {
      const binding = p.scope.getBinding(p.node.name);
      return binding && binding.path.isVariableDeclarator() && binding.path.node.init ? evaluate(binding.path.get('init')) : null;
    }
    if (p.isNewExpression() && p.get('callee').isIdentifier({ name: 'URL' })) { // new URL('./routes', import.meta.url)
      const [relative, base] = p.get('arguments').map(evaluate);
      return relative != null && base ? path.resolve(path.dirname(base), relative) : null;
    }
    if (!p.isCallExpression()) return null;
    const callee = p.get('callee');
    const name = callee.isMemberExpression() ? propertyName(callee) : callee.isIdentifier() ? callee.node.name : null;
    const args = p.get('arguments').map(evaluate);
    if (args.some((arg) => arg == null)) return null;
    if (name === 'fileURLToPath') return args[0];
    if (name === 'dirname') return path.dirname(args[0]);
    if (name === 'join') return path.join(...args);
    if (name === 'resolve') return path.resolve(path.dirname(file), ...args);
    return null;
  };
  const result = evaluate(expression);
  return result && path.isAbsolute(result) ? result : null;
}

module.exports = { Fastify };
