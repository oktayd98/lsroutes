# lsroutes

List every endpoint of an Express, Fastify, NestJS or Hono project, like `rails routes`.

```
$ npx lsroutes
┌────────┬─────────────────────┬───────────────────────┬──────────────────────────┐
│ Method │ Path                │ Handler               │ Source                   │
├────────┼─────────────────────┼───────────────────────┼──────────────────────────┤
│ GET    │ /api/v1/users       │ UserController.index  │ src/routes/v1/users.js:6 │
│ GET    │ /api/v1/users/:id   │ UserController.show   │ src/routes/v1/users.js:7 │
│ POST   │ /api/v1/users       │ UserController.create │ src/routes/v1/users.js:8 │
│ DELETE │ /api/v1/users/:id   │ UserController.delete │ src/routes/v1/users.js:9 │
├────────┼─────────────────────┼───────────────────────┼──────────────────────────┤
│ POST   │ /api/v1/auth/login  │ authController.login  │ src/routes/v1/auth.js:5  │
│ POST   │ /api/v1/auth/logout │ authController.logout │ src/routes/v1/auth.js:6  │
├────────┼─────────────────────┼───────────────────────┼──────────────────────────┤
│ GET    │ /                   │ home.index            │ src/index.js:11          │
│ GET    │ /health             │ function              │ src/index.js:12          │
└────────┴─────────────────────┴───────────────────────┴──────────────────────────┘
8 routes (0.31s)
```

Express and Fastify have no standard folder layout (and NestJS controllers can live anywhere), so `lsroutes` doesn't guess from file names. It reads the code and follows your routers wherever they are defined and mounted, then prints each endpoint with its full path, its handler and the file and line where it is declared.

## Usage

Run it in the root of an Express, Fastify, NestJS or Hono project (JavaScript or TypeScript):

```sh
npx lsroutes              # scan the current directory
npx lsroutes ./my-api     # scan another directory
```

Or install it globally:

```sh
npm install -g lsroutes
lsroutes
```

| Argument / option | Description |
|---|---|
| `[dir]` | Project directory to scan. Defaults to the current directory. |
| `--no-cache` | Ignore the cached result and analyze again. |
| `--color` | Force colors, e.g. when piping into `less -R`. |
| `--no-color` | Disable colors. |
| `-v`, `--version` | Print the version. |
| `-h`, `--help` | Print usage. |

Colors are only used when the output goes to a terminal, so `lsroutes | grep users` gives plain text. The `NO_COLOR` and `FORCE_COLOR` environment variables are honored too; `--color` and `--no-color` take precedence over them.

Requires Node.js 18 or newer.

## How it works

`lsroutes` analyzes your source code statically. **Your app is never started or imported**, so there are no database connections, no `listen()` and no side effects.

It parses every `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts` and `.tsx` file and follows `express()` and `Router()` objects through:

- variables, `import` / `require`, `export default`, `module.exports`, re-exports and barrel files (`export { default as users } from './users'`)
- path aliases from `tsconfig.json` / `jsconfig.json` (`paths` and `baseUrl`, including `extends` chains), e.g. `import users from '@/routes/users'`
- `app.use('/prefix', router)` mounts, including nested routers and arrays of routers
- `router.route('/x').get(...).post(...)` chains
- path constants and template strings (`` app.use(`${API}/users`, users) ``)
- functions that receive the app (`require('./routes')(app)`) and functions that return a router (also as `Object.assign(router, { ...helpers })`)
- class-based controllers (`this.router = Router()`, `app.use('/', new UserController().router)`)
- route tables mounted in a loop (`routes.forEach(r => router.use(r.path, r.router))`, `for...of`)

For Fastify it also understands:

- shorthand routes (`fastify.get(path, [options], handler)`) and full declarations (`fastify.route({ method, url, handler })`, including method arrays)
- plugins: `fastify.register(plugin, { prefix })`, nested to any depth, with the plugin passed as a function, an import, `import('./routes.js')` or `require()`
- `fastify-plugin` (`fp(plugin)`): no encapsulation, so the `prefix` option does not apply, as in Fastify
- `@fastify/autoload` with its rules: directory names as prefixes, index files, `autohooks` files, `autoPrefix` / `prefixOverride` exports, `options.prefix`, `dirNameRoutePrefix`, `routeParams` and `ignorePattern`; `dir` can be `path.join(__dirname, 'routes')`, `import.meta.dirname` or `fileURLToPath(new URL(...))`
- instance methods that return the instance (`fastify().withTypeProvider()`, `addHook`, `decorate`, ...)

For NestJS it reads the decorators from `@nestjs/common`:

- `@Controller('users')`, `@Controller(['a', 'b'])`, `@Controller({ path, version })` with `@Get()`, `@Post(':id')`, `@Put(['a', 'b'])`, ... on its methods, also when the decorators come through `import * as common`
- route methods inherited from a base class (`class UsersController extends CrudController`); a method overridden without a route decorator is no longer a route, as in Nest
- `app.setGlobalPrefix('api', { exclude: [...] })`, with exclude rules as strings or `{ path, method }` and path-to-regexp patterns (`:id`, `(.*)`, `{/*splat}`)
- URI versioning: `app.enableVersioning({ type: VersioningType.URI, defaultVersion, prefix })`, `@Version('2')`, version arrays and `VERSION_NEUTRAL`
- one bootstrap file (`main.ts`) per app: in a monorepo, each controller takes the prefix and versioning of the bootstrap file in the nearest directory

For Hono it understands:

- `new Hono()` from `hono`, `hono/tiny` or `hono/quick`, with `app.get(path, ...handlers)`, `app.all()` and `app.on(method, path, ...handlers)`, also with arrays of methods and paths
- chains, including routes that reuse the previous path (`app.get('/items', list).post(create)`)
- `app.route('/users', users)` mounts, chained too (`const routes = app.route('/a', a).route('/b', b)`)
- `app.basePath('/api')`, also chained (`new Hono().basePath('/api')`) and nested

### Grouping

Routes are grouped by the router that defines them, mounted at a given prefix. A router file is a group, whatever it is named and wherever it lives. Within one router, routes are split again by their first static path segment (`/users/...` vs `/posts/...`), so an app that defines everything on a single `app` still gets readable groups. Parameters such as `:id` don't start a new group, and one-route segments of the same router share a group.

### Caching

The result is cached in your OS temp directory. The cache key is a hash of every scanned source and `tsconfig`/`jsconfig` file's path and content plus the code of `lsroutes` itself, so upgrading the tool also invalidates it. Editing, adding or deleting a file triggers a fresh analysis. The last line of the output says whether the result came from the cache and how long the run took: `8 routes (cached, 0.08s)`. A `tsconfig` outside the scanned directory (in a parent directory, or extended from a package) is not part of the key: after changing one, run with `--no-cache`. See [Benchmark](#benchmark) for timings.

### Memory

Parsed files take a lot of memory: about 70 bytes per byte of source once Babel's paths and scopes are built. So every file is parsed once for a small summary (its imports, exports and calls) and dropped; only the files the analysis has to look inside are parsed again and kept. That is decided from the summaries: a file with no call that can define a route, no NestJS controller and no call that can reach a function the analysis follows is never kept. On a NestJS monorepo of 13,000 files (75 MB of source) about 2,000 files are kept and the run needs about 1.7 GB, instead of over 5 GB.

### Skipped files

- Directories: `node_modules`, `bower_components`, `jspm_packages`, `vendor`, `dist`, `build`, `out`, `coverage`, `__tests__`, `test`, `tests` and any directory starting with `.`
- Files: `*.test.*`, `*.spec.*`, `*.d.ts`, `*.min.js`

Test files and directories are skipped because they often create throwaway apps (a test helper registering the app's plugins on a second instance would list every route twice).

## Benchmark

`npm run bench` generates a synthetic Express + TypeScript project with **1,000 endpoints** in your temp directory. It first checks that `lsroutes` finds all 1,000 of them with no warnings, then measures it. The project is built to hit the expensive paths of the analysis:

| Scenario | Routes | What it stresses |
|---|---|---|
| 60 resource routers behind nested `export *` barrels, imported through a `@/` tsconfig alias | 600 | module and alias resolution, re-export fan-out |
| 20 class-based controllers mounted with `forEach` | 100 | per-element loop resolution (uncached) |
| a table of 100 routers mounted in a loop with destructuring | 100 | the same, at scale |
| routers nested 5 levels deep | 100 | mount traversal |
| `app` passed through 3 functions into 20 CommonJS modules | 100 | call-site index, parameter tracing |
| 1,200 unrelated files calling `.get()`, `.post()`, `.use()` on plain objects, forming an import cycle | 0 | parsing, false positives, deep value chains |
| one 400 KB generated file with 5,000 functions calling each other | 0 | call-site index size |
| a lexer reassigning one variable 300 times | 0 | reassignment tracking |

Results on an Apple M4, Node 24 (median of 5 runs):

| Project | Files | Routes | Cold (`--no-cache`) | Cached |
|---|---|---|---|---|
| synthetic benchmark | 1,479 (32,713 lines) | 1,000 | 0.71 s | 0.09 s |

On open-source projects (cold, `--no-cache`):

| Project | Framework | Routes | Cold |
|---|---|---|---|
| large backend, plugins nested several levels | Fastify | 1,497 | 4.1 s |
| server API in a monorepo | Fastify | 571 | 1.2 s |
| storage API | Fastify | 128 | 0.6 s |
| small REST API | Fastify | 69 | 0.2 s |
| demo app | Fastify (autoload) | 14 | 0.1 s |
| media server | NestJS | 318 | 0.7 s |
| Nx monorepo | NestJS | 149 | 0.4 s |

A cached run of any of them takes about 0.1 s.

`RUNS=10 npm run bench` changes the number of runs.

## Output notes

- **Handler** shows the last handler passed to the route (`usersController.list`, `UserController#me` for `this.me` inside a class, or for a NestJS controller method). Inline functions (`(req, res) => ...`, `function (req, res) {...}`) show as *function*, in italics on terminals that support it.
- A prefix that can't be known without running the app (`app.use(process.env.PREFIX, router)`) is shown as a placeholder: `{process.env.PREFIX}/users`.
- If a router is never mounted, or its mount can't be resolved, its routes are still listed without a prefix. When the project has an app (an `express()` app, a Fastify instance, a NestJS controller or a Hono app), a warning is also printed on stderr for an unmounted Express router or Fastify plugin. Without one (e.g. a package that only exports routers) there is nothing to mount on, so no warning is printed.

## Limitations

General:

- Express, Fastify, NestJS and Hono only (JavaScript and TypeScript). Other frameworks (Koa, `routing-controllers`, ...) are not supported yet.
- Routes registered dynamically are missed: routers stored under computed keys and registered through `Object.entries(...)`, or passed through project-specific wrappers that change the prefix. On the largest Fastify backend we tested, which does this for its integrations, about 85% of `route()` declarations are listed.
- Method names computed at runtime (`router[method](...)`) are not detected.
- Values passed to a parent constructor are not followed: in `class AdminRoutes extends Base { constructor(app) { super(app); } }`, `app` inside `Base` is unknown.
- Conditionally registered routes (`if (env === 'development')`) are always listed.
- Routes are listed group by group, in the order the analysis meets them (files alphabetically, then source order). This can differ from the order the framework matches them in.
- Path aliases are read from the nearest `tsconfig.json` / `jsconfig.json`. Bundler-only aliases (webpack, Vite), `package.json` `imports` (`#routes/*`) and workspace packages imported by name (`import users from '@acme/routes'`, unless a tsconfig path maps it) are not resolved.
- In a monorepo, the routes of every app are listed in one table; the Source column tells which app a route belongs to.
- Files Babel cannot parse are skipped with a warning. One known case: a decorator on a class property with a computed name (`@Type(() => X) [KEY]: X`).
- To keep memory low, calls are ruled out from their shape before anything is resolved (see [Memory](#memory)). This misses a few rare patterns: a route path that is a string not starting with `/` or `*`, `route.get(handler)` on a `router.route('/x')` result imported from another file, and a function passed as a value into a file that does not import it and called there (`mountAll(app, [users])` calling `users(app)` in a helper file).

Express:

- A router created in a shared base class (`class BaseController { router = Router() }`) is treated as one router for all subclasses, so each subclass's routes also appear under the other subclasses' mount paths. Routers created in each subclass (or its constructor) are fine.
- Routers from other packages (`express-promise-router`, etc.) are not detected.

Fastify:

- Apps started only through `fastify-cli` (`fastify start app.js`, with no `Fastify()` call in the code) are not supported yet: the root plugin is never registered in code, so its routes are not found.

NestJS:

- `RouterModule.register()` module prefixes are not applied, controllers declared through custom decorators (`applyDecorators(Controller(...))`) are not found, and a controller is listed even if no module registers it. The `host` option is ignored.
- In a monorepo, an app without its own `setGlobalPrefix()` / `enableVersioning()` takes those of the bootstrap file in the nearest directory, even when that belongs to another app.

Hono:

- `OpenAPIHono` (`@hono/zod-openapi`, `app.openapi(createRoute(...), handler)`), apps made by `createFactory().createApp()` and other apps mounted with `app.mount()` are not supported yet.
- A Hono app that is never mounted is listed without a prefix and without a warning, since a sub-app is a full app too.

## Development

```sh
npm install
npm test       # runs the test suite (test/fixture plus generated projects)
npm run bench  # generates a 1,000-endpoint project and times it
npm link       # makes the `lsroutes` command use your local copy
```

### Code structure

```
bin/lsroutes.js          CLI: options, output, exit codes
src/index.js             listRoutes(root): files -> parse -> collect -> report, with the cache
src/cli/                 option parsing and help text, table rendering
src/project/             finding files, parsing them (sourceFile.js), resolving imports and tsconfig path aliases
src/analysis/
  values.js              every kind of value an expression can evaluate to
  resolver.js            "what can this expression be?": the hub with cycle, depth and memo guards
  expressions.js         rules per expression type (calls, members, strings, ...)
  dataflow.js            rules for variables, parameters, returns and arrays
  members.js, modules.js rules for `x.name` and for imports, require() and exports
  routers.js             the app/router/plugin model
  collector.js           finds app.get(), router.use() ... calls and records them on routers
src/frameworks/          one adapter per framework (express.js, fastify.js, nestjs.js, hono.js), see framework.js for the hooks
src/report/groups.js     full paths from the mount tree, grouping, warnings
```

The rule modules only call back into the resolver, never into each other, so each one can be read on its own. To support a new kind of expression, add a rule to the table in `expressions.js`; to support a new kind of value, add it to `values.js`.

Nothing outside `src/frameworks/` names a framework. An adapter tells the core what its packages are (`express`, `fastify`, `@nestjs/common`, `hono`), what calling or instantiating them creates, what a method called on one of its routers returns, and which of those calls define routes or mount routers. Frameworks whose routes are not method calls (NestJS decorators) collect them in a pass over the whole project (`collectProject`). To support another framework, write an adapter extending `Framework` in `src/frameworks/framework.js` and add it to `createFrameworks()` in `src/frameworks/index.js`.

## License

MIT
