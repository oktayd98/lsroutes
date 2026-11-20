'use strict';
/**
 * NestJS: `@Controller(path)` classes whose methods carry `@Get(path)`, `@Post()`, ... decorators, the bootstrap
 * file's `app.setGlobalPrefix(prefix, { exclude })` and URI versioning (`app.enableVersioning()`, `@Version()`).
 * Routes are decorators rather than method calls, so everything happens in collectProject.
 */
const path = require('path');
const { Framework } = require('./framework');
const { optionPath, stringOption } = require('./options');
const { Kind, Value } = require('../analysis/values');
const { keyName, propertyName } = require('../analysis/ast');

const PACKAGE = '@nestjs/common';
const ROUTE_DECORATORS = new Map(['Get', 'Post', 'Put', 'Delete', 'Patch', 'Options', 'Head', 'All', 'Search',
  'Propfind', 'Proppatch', 'Mkcol', 'Copy', 'Move', 'Lock', 'Unlock'].map((name) => [name, name.toLowerCase()]));
const NEUTRAL = null; // VERSION_NEUTRAL, or no version: the path gets no version segment
const NO_BOOTSTRAP = { dir: '', prefixes: ['/'], exclude: [], versioning: null };

class NestJS extends Framework {
  constructor() {
    super('nestjs');
    this.packages = [PACKAGE];
  }

  packageValue() {
    return Value.framework('nestjs', PACKAGE);
  }

  /** Every export of @nestjs/common is a value named by its export: Controller, Get, VERSION_NEUTRAL, ... */
  member(resolver, value, name) {
    return value.symbol === PACKAGE ? [Value.framework('nestjs', name)] : [];
  }

  collectProject(context) {
    const { resolver } = context;
    const bootstraps = findBootstraps(resolver);
    for (const file of resolver.project.sourceFiles()) {
      for (const summary of controllerDecorators(file)) {
        const call = file.callAt(summary);
        const cls = call && call.parentPath.parentPath;
        if (call && decoratorName(resolver, call) === 'Controller' && cls.isClass()) {
          collectController(context, cls, call, bootstrapFor(bootstraps, file.filePath));
        }
      }
    }
  }
}

/**
 * Class decorators of a file that may be `@Controller(...)`, judged from the file's summary: the file imports
 * Controller (under any name) or all of @nestjs/common. Services, modules and entities are not parsed for paths.
 */
function controllerDecorators(file) {
  const specifiers = file.imports.filter((entry) => entry.kind === 'import' && entry.source === PACKAGE).flatMap((entry) => entry.specifiers);
  if (!specifiers.length) return [];
  const names = new Set(specifiers.filter((s) => s.imported === 'Controller').map((s) => s.local));
  const namespaces = specifiers.some((s) => s.imported === '*');
  return file.callSummaries.filter((call) => call.onClass && (names.has(call.callee) || (namespaces && call.method === 'Controller')));
}

/** The @nestjs/common export a decorator call `@Name(...)` uses, or null. */
function decoratorName(resolver, call) {
  if (!call.isCallExpression() || !call.parentPath.isDecorator()) return null;
  const nest = resolver.resolve(call.get('callee')).find((value) => value.kind === Kind.FRAMEWORK && value.framework === 'nestjs');
  return nest ? nest.symbol : null;
}

function collectController(context, cls, controllerCall, bootstrap) {
  const { resolver } = context;
  const controller = controllerOptions(resolver, controllerCall.get('arguments.0'));
  const router = resolver.router('nestjs', 'app', cls); // Nest mounts every controller on the app itself
  const className = cls.node.id ? cls.node.id.name : 'default';
  for (const { method, routeCall, httpMethod } of routeMethods(resolver, cls)) {
    const versionCall = decoratorCalls(resolver, method).find(([name]) => name === 'Version');
    const versions = !bootstrap.versioning ? [NEUTRAL]
      : versionCall ? versionsOf(resolver, versionCall[1].get('arguments.0'))
        : controller.versions || bootstrap.versioning.defaultVersions;
    const methodPaths = argumentPaths(resolver, routeCall.get('arguments.0'));
    for (const controllerPath of controller.paths) {
      for (const methodPath of methodPaths) {
        const routePath = joinPath(controllerPath, methodPath);
        const excluded = bootstrap.exclude.some((rule) => (!rule.method || rule.method === httpMethod) && rule.regex.test(routePath));
        for (const prefix of excluded ? ['/'] : bootstrap.prefixes) {
          for (const version of versions) {
            const versionSegment = version === NEUTRAL ? '' : bootstrap.versioning.prefix + version;
            const handler = `${className}#${keyName(method.node)}`;
            context.addRoute(router, { method: httpMethod, path: joinPath(prefix, versionSegment, routePath), handler, callPath: routeCall });
          }
        }
      }
    }
  }
}

/**
 * Route methods of a controller class and its superclasses, as Nest finds them on the prototype chain: a method
 * overridden without a route decorator is no longer a route.
 */
function routeMethods(resolver, cls, seenNames = new Set(), seenClasses = new Set()) {
  if (seenClasses.has(cls.node)) return [];
  seenClasses.add(cls.node);
  const found = [];
  for (const member of cls.get('body.body')) {
    if (!member.isClassMethod({ kind: 'method' }) || member.node.static || seenNames.has(keyName(member.node))) continue;
    seenNames.add(keyName(member.node));
    for (const [name, routeCall] of decoratorCalls(resolver, member)) {
      if (ROUTE_DECORATORS.has(name)) found.push({ method: member, routeCall, httpMethod: ROUTE_DECORATORS.get(name) });
    }
  }
  if (!cls.node.superClass) return found;
  const superclasses = resolver.resolve(cls.get('superClass')).filter((value) => value.kind === Kind.CLASS);
  return found.concat(superclasses.flatMap((value) => routeMethods(resolver, value.declaration, seenNames, seenClasses)));
}

/** [name, call] of each `@Name(...)` decorator of a class member that comes from @nestjs/common. */
function decoratorCalls(resolver, member) {
  if (!member.node.decorators) return [];
  return member.get('decorators')
    .map((decorator) => decorator.get('expression'))
    .map((call) => [decoratorName(resolver, call), call])
    .filter(([name]) => name);
}

/** `@Controller()`, `@Controller('users')`, `@Controller(['a', 'b'])`, `@Controller({ path, version })` */
function controllerOptions(resolver, arg) {
  const objects = arg?.node ? resolver.resolve(arg).filter((value) => value.kind === Kind.OBJECT) : [];
  if (!objects.length) return { paths: argumentPaths(resolver, arg), versions: null };
  const version = optionPath(objects, 'version');
  return { paths: stringOption(resolver, objects, 'path') || ['/'], versions: version && versionsOf(resolver, version) };
}

/** Paths of a decorator argument: none is '/', an unknown expression is a placeholder. */
const argumentPaths = (resolver, arg) => (arg?.node ? resolver.routePaths(arg) || [resolver.placeholder(arg)] : ['/']);

/** `'1'`, `['1', '2']`, `VERSION_NEUTRAL`, a constant; unknown versions are placeholders. */
function versionsOf(resolver, arg) {
  if (!arg?.node) return [NEUTRAL];
  if (arg.isArrayExpression()) return arg.get('elements').flatMap((element) => versionsOf(resolver, element));
  const values = resolver.resolve(arg);
  if (values.some((value) => value.kind === Kind.FRAMEWORK && value.symbol === 'VERSION_NEUTRAL')) return [NEUTRAL];
  const strings = values.filter((value) => value.kind === Kind.STRING).map((value) => value.value);
  return strings.length ? strings : [resolver.placeholder(arg)];
}

/**
 * `app.setGlobalPrefix()` and `app.enableVersioning()` calls, one entry per file (the bootstrap file, main.ts).
 * shortcut: calls are matched by method name, not by resolving `app` (NestFactory.create); the names are Nest's own.
 */
function findBootstraps(resolver) {
  const byFile = new Map();
  for (const file of resolver.project.sourceFiles()) {
    for (const summary of file.callSummaries) {
      const name = summary.method;
      if (name !== 'setGlobalPrefix' && name !== 'enableVersioning') continue;
      const call = file.callAt(summary);
      if (!call) continue;
      if (!byFile.has(file.filePath)) byFile.set(file.filePath, { ...NO_BOOTSTRAP, dir: path.dirname(file.filePath) });
      const bootstrap = byFile.get(file.filePath);
      const [first, second] = [call.get('arguments.0'), call.get('arguments.1')];
      if (name === 'setGlobalPrefix') {
        bootstrap.prefixes = argumentPaths(resolver, first);
        bootstrap.exclude = second?.node ? excludeRules(resolver, second) : [];
      } else {
        bootstrap.versioning = uriVersioning(resolver, first);
      }
    }
  }
  return [...byFile.values()];
}

/**
 * The bootstrap of a controller file: the one in the nearest directory, so each app of a monorepo gets its own.
 * shortcut: the directory is a guess at which app imports the controller; follow the module imports from
 * NestFactory.create(AppModule) if apps in one monorepo share controllers but set different prefixes.
 */
function bootstrapFor(bootstraps, filePath) {
  let best = NO_BOOTSTRAP;
  let bestLength = -1;
  for (const bootstrap of bootstraps) {
    const length = commonDirectoryLength(bootstrap.dir, filePath);
    if (length > bestLength) [best, bestLength] = [bootstrap, length];
  }
  return best;
}

function commonDirectoryLength(dir, filePath) {
  const a = dir.split(path.sep);
  const b = path.dirname(filePath).split(path.sep);
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i;
}

/** `enableVersioning()` / `enableVersioning({ type: VersioningType.URI, defaultVersion, prefix })`; null for other types. */
function uriVersioning(resolver, arg) {
  const objects = arg?.node ? resolver.resolve(arg).filter((value) => value.kind === Kind.OBJECT) : [];
  if (arg?.node && !objects.length) return null; // unknown options
  const type = optionPath(objects, 'type');
  if (type && !(type.isMemberExpression() && propertyName(type) === 'URI')) return null; // header or media type: paths unchanged
  const prefix = optionPath(objects, 'prefix');
  return {
    prefix: !prefix ? 'v' : prefix.isBooleanLiteral({ value: false }) ? '' : resolver.stringOf(prefix),
    defaultVersions: versionsOf(resolver, optionPath(objects, 'defaultVersion')),
  };
}

/** `exclude: ['health', { path: 'hooks/(.*)', method: RequestMethod.POST }]`: routes without the global prefix. */
function excludeRules(resolver, options) {
  const objects = resolver.resolve(options).filter((value) => value.kind === Kind.OBJECT);
  const exclude = optionPath(objects, 'exclude');
  if (!exclude) return [];
  return resolver.elements(resolver.resolve(exclude)).flatMap((route) => {
    if (route.kind === Kind.STRING) return [{ regex: patternRegex(route.value), method: null }];
    if (route.kind !== Kind.OBJECT) return [];
    const method = optionPath([route], 'method');
    const methodName = method && method.isMemberExpression() ? propertyName(method).toLowerCase() : 'all';
    return (stringOption(resolver, [route], 'path') || []).map((pattern) => ({
      regex: patternRegex(pattern),
      method: methodName === 'all' ? null : methodName,
    }));
  });
}

const PATTERN_TOKENS = { '{': '(?:', '}': ')?', '}?': ')?' }; // path-to-regexp optional groups: `{/:id}`, v6 `{/:id}?`

/**
 * A path-to-regexp pattern as a RegExp: `:id` is one segment; `(.*)`, `*` and `*splat` are anything; `{...}` is optional.
 * shortcut: custom parameter patterns (`:id(\\d+)`) are not supported; use path-to-regexp itself if exclude rules need them.
 */
function patternRegex(pattern) {
  const source = joinPath(pattern)
    .split(/(\}\??|\{|\(\.\*\)|\*\w*|:\w+)/)
    .map((part, i) => (i % 2 === 0 ? part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      : PATTERN_TOKENS[part] || (part.startsWith(':') ? '[^/]+' : '.*')))
    .join('');
  return new RegExp(`^${source}/?$`, 'i');
}

/** joinPath('/api', 'v1', 'users/') -> '/api/v1/users' */
const joinPath = (...parts) => ('/' + parts.join('/')).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

module.exports = { NestJS };
