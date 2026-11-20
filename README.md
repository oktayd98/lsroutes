# lsroutes

List every endpoint of an Express or Fastify project, like `rails routes`.

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
8 routes
```

Express and Fastify have no standard folder layout, so `lsroutes` doesn't guess from file names. It reads the code and follows your routers wherever they are defined and mounted, then prints each endpoint with its full path, its handler and the file and line where it is declared.

## Usage

Run it in the root of an Express or Fastify project (JavaScript or TypeScript):

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

### Grouping

Routes are grouped by the router that defines them, mounted at a given prefix. A router file is a group, whatever it is named and wherever it lives. Within one router, routes are split again by their first static path segment (`/users/...` vs `/posts/...`), so an app that defines everything on a single `app` still gets readable groups. Parameters such as `:id` don't start a new group, and one-route segments of the same router share a group.

### Caching

The result is cached in your OS temp directory. The cache key is a hash of every scanned source and `tsconfig`/`jsconfig` file's path and content plus the code of `lsroutes` itself, so upgrading the tool also invalidates it. Editing, adding or deleting a file triggers a fresh analysis. A `tsconfig` outside the scanned directory (in a parent directory, or extended from a package) is not part of the key: after changing one, run with `--no-cache`. See [Benchmark](#benchmark) for timings.

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
| synthetic benchmark | 1,479 (32,713 lines) | 1,000 | 1.36 s | 0.09 s |

On open-source projects (cold, `--no-cache`):

| Project | Framework | Routes | Cold |
|---|---|---|---|
| large backend, plugins nested several levels | Fastify | 1,497 | 7.9 s |
| server API in a monorepo | Fastify | 571 | 1.8 s |
| storage API | Fastify | 128 | 1.4 s |
| small REST API | Fastify | 69 | 0.2 s |
| demo app | Fastify (autoload) | 14 | 0.1 s |

A cached run of any of them takes about 0.1 s.

`RUNS=10 npm run bench` changes the number of runs.

## Output notes

- **Handler** shows the last handler passed to the route (`usersController.list`, `UserController#me` for `this.me` inside a class). Inline functions (`(req, res) => ...`, `function (req, res) {...}`) show as *function*, in italics on terminals that support it.
- A prefix that can't be known without running the app (`app.use(process.env.PREFIX, router)`) is shown as a placeholder: `{process.env.PREFIX}/users`.
- If a router is never mounted, or its mount can't be resolved, its routes are still listed without a prefix. When the project has an `express()` app, a warning is also printed on stderr. Without one (e.g. a package that only exports routers) there is nothing to mount on, so no warning is printed.

## Limitations

- Express and Fastify only (JavaScript and TypeScript). Decorator-based frameworks like NestJS or `routing-controllers` are not supported yet.
- Routes registered dynamically are missed: routers stored under computed keys and registered through `Object.entries(...)`, or passed through project-specific wrappers that change the prefix. On the largest Fastify backend we tested, which does this for its integrations, about 85% of `route()` declarations are listed.
- Path aliases are read from the nearest `tsconfig.json` / `jsconfig.json`. Bundler-only aliases (webpack, Vite) and `package.json` `imports` (`#routes/*`) are not resolved.
- Method names computed at runtime (`router[method](...)`) are not detected.
- Fastify apps started only through `fastify-cli` (`fastify start app.js`, with no `Fastify()` call in the code) are not supported yet: the root plugin is never registered in code, so its routes are not found.
- A router created in a shared base class (`class BaseController { router = Router() }`) is treated as one router for all subclasses, so each subclass's routes also appear under the other subclasses' mount paths. Routers created in each subclass (or its constructor) are fine.
- Routes are listed group by group, in the order the analysis meets them (files alphabetically, then source order). This can differ from the order the framework matches them in.
- Conditionally registered routes (`if (env === 'development')`) are always listed.
- Routers from other packages (`express-promise-router`, etc.) are not detected.

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
src/project/             finding files, parsing them, resolving imports and tsconfig path aliases
src/analysis/
  values.js              every kind of value an expression can evaluate to
  resolver.js            "what can this expression be?": the hub with cycle, depth and memo guards
  expressions.js         rules per expression type (calls, members, strings, ...)
  dataflow.js            rules for variables, parameters, returns and arrays
  members.js, modules.js rules for `x.name` and for imports, require() and exports
  routers.js             the app/router/plugin model
  collector.js           finds app.get(), router.use() ... calls and records them on routers
src/frameworks/          one adapter per framework (express.js, fastify.js), see framework.js for the hooks
src/report/groups.js     full paths from the mount tree, grouping, warnings
```

The rule modules only call back into the resolver, never into each other, so each one can be read on its own. To support a new kind of expression, add a rule to the table in `expressions.js`; to support a new kind of value, add it to `values.js`.

Nothing outside `src/frameworks/` names a framework. An adapter tells the core what its packages are (`express`, `fastify`), what calling or instantiating them creates, what a method called on one of its routers returns, and which of those calls define routes or mount routers. To support another framework, write an adapter extending `Framework` in `src/frameworks/framework.js` and add it to `createFrameworks()` in `src/frameworks/index.js`.

## License

MIT
