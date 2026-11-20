'use strict';
// Generates a synthetic Express + TypeScript project with exactly 1000 endpoints and code shaped to stress
// lsroutes: barrels and aliases, loops, deep mounts, app passed through functions, many unrelated files,
// one huge generated file and a lexer-style variable reassigned hundreds of times.
const fs = require('fs');
const path = require('path');

const RESOURCES = 60; // x10 routes = 600
const CONTROLLERS = 20; // x5 routes = 100
const TABLE = 100; // x1 route = 100
const DEEP_LEVELS = 5; // x20 routes = 100
const MODULES = 20; // x5 routes = 100
const NOISE_FILES = 1200;
const BIG_FUNCTIONS = 5000;
const LEXER_REASSIGNMENTS = 300;
const EXPECTED_ROUTES = RESOURCES * 10 + CONTROLLERS * 5 + TABLE + DEEP_LEVELS * 20 + MODULES * 5;

function generate(root) {
  fs.rmSync(root, { recursive: true, force: true });
  const write = (rel, text) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const range = (n) => [...Array(n).keys()];

  write('package.json', JSON.stringify({ name: 'lsroutes-bench-app', private: true }, null, 2));
  write('tsconfig.json', `{
  // aliases like most TS backends
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
  },
}
`);

  // 1. resources: routes/index.ts -> export * from 6 group barrels -> export * from 10 routers each
  const GROUP = 10;
  write('src/routes/index.ts', range(RESOURCES / GROUP).map((g) => `export * from './group${g}';\n`).join(''));
  for (const g of range(RESOURCES / GROUP)) {
    write(`src/routes/group${g}/index.ts`, range(GROUP).map((i) => `export * from './resource${g * GROUP + i}';\n`).join(''));
    for (const i of range(GROUP)) {
      const n = g * GROUP + i;
      write(`src/routes/group${g}/resource${n}.ts`, `import { Router } from 'express';
import * as ctrl from '@/services/resource${n}';

const router = Router();
router.get('/', ctrl.list);
router.get('/:id', ctrl.show);
router.post('/', ctrl.create);
router.put('/:id', ctrl.replace);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.route('/:id/items').get(ctrl.listItems).post(ctrl.addItem);
router.get('/:id/items/:itemId', ctrl.showItem);
router.delete('/:id/items/:itemId', ctrl.removeItem);

export const resource${n}Router = router;
`);
      write(`src/services/resource${n}.ts`, `import type { Request, Response } from 'express';
const cache = new Map<string, unknown>();
const handlers = ['list', 'show', 'create', 'replace', 'update', 'remove', 'listItems', 'addItem', 'showItem', 'removeItem'];
const reply = (res: Response, value: unknown) => res.status(200).json(value);
export function list(req: Request, res: Response) { reply(res, [...cache.values()]); }
export function show(req: Request, res: Response) { reply(res, cache.get(req.params.id)); }
export function create(req: Request, res: Response) { cache.set(String(cache.size), req.body); reply(res, req.body); }
export function replace(req: Request, res: Response) { cache.set(req.params.id, req.body); reply(res, req.body); }
export function update(req: Request, res: Response) { cache.set(req.params.id, { ...(cache.get(req.params.id) as object), ...req.body }); reply(res, null); }
export function remove(req: Request, res: Response) { cache.delete(req.params.id); res.status(204).end(); }
export const listItems = (req: Request, res: Response) => reply(res, handlers.map((h) => h.toUpperCase()));
export const addItem = (req: Request, res: Response) => reply(res, req.body);
export const showItem = (req: Request, res: Response) => reply(res, req.params);
export const removeItem = (req: Request, res: Response) => res.status(204).end();
`);
    }
  }

  // 2. class-based controllers, mounted from an array with forEach
  for (const c of range(CONTROLLERS)) {
    write(`src/controllers/c${c}.ts`, `import { Router, type Request, type Response } from 'express';

export class C${c}Controller {
  public router = Router();
  constructor() {
${range(5).map((m) => `    this.router.get('/c${c}/action${m}', this.action${m});`).join('\n')}
  }
${range(5).map((m) => `  action${m}(req: Request, res: Response) { res.json({ controller: ${c}, action: ${m} }); }`).join('\n')}
}
`);
  }
  write('src/controllers/index.ts', `import type { Application } from 'express';
${range(CONTROLLERS).map((c) => `import { C${c}Controller } from './c${c}';`).join('\n')}

const controllers = [${range(CONTROLLERS).map((c) => `new C${c}Controller()`).join(', ')}];

export function mountControllers(app: Application) {
  controllers.forEach((controller) => app.use('/ctrl', controller.router));
}
`);

  // 3. route table: 100 tiny routers mounted in a loop with destructuring
  for (const t of range(TABLE)) {
    write(`src/table/t${t}.ts`, `import { Router } from 'express';\nconst r = Router();\nr.get('/', (req, res) => res.send('t${t}'));\nexport default r;\n`);
  }
  write('src/table/index.ts', `import { Router } from 'express';
${range(TABLE).map((t) => `import t${t} from './t${t}';`).join('\n')}

const routes = [
${range(TABLE).map((t) => `  { path: '/t${t}', router: t${t} },`).join('\n')}
];

export const tableRouter = Router();
routes.forEach(({ path, router }) => tableRouter.use(path, router));
`);

  // 4. deep nesting: level0 mounts level1 mounts ... level4
  for (const l of range(DEEP_LEVELS)) {
    write(`src/deep/level${l}.ts`, `import { Router } from 'express';
${l < DEEP_LEVELS - 1 ? `import { deepRouter${l + 1} } from './level${l + 1}';\n` : ''}
export const deepRouter${l} = Router();
${range(20).map((i) => `deepRouter${l}.get('/e${i}', (req, res) => res.end());`).join('\n')}
${l < DEEP_LEVELS - 1 ? `deepRouter${l}.use('/l${l + 1}', deepRouter${l + 1});\n` : ''}`);
  }

  // 5. app passed through registerAll -> registerModules -> m.register(app) in 20 CommonJS modules
  for (const m of range(MODULES)) {
    write(`src/register/modules/m${m}.js`, `module.exports.register = function (app) {
${range(5).map((i) => `  app.get('/modules/m${m}/r${i}', function (req, res) { res.end(); });`).join('\n')}
};
`);
  }
  write('src/register/modules.ts', `import type { Application } from 'express';
const modules = [${range(MODULES).map((m) => `require('./modules/m${m}')`).join(', ')}];
export function registerModules(app: Application) {
  for (const m of modules) m.register(app);
}
`);
  write('src/register/index.ts', `import type { Application } from 'express';
import { registerModules } from './modules';
export function registerAll(app: Application) {
  registerModules(app);
}
`);

  // noise: ordinary code that looks a bit like routing (get/use/post on non-routers) but is not
  for (const n of range(NOISE_FILES)) {
    write(`src/lib/util${n}.ts`, `import { helper${(n + 1) % NOISE_FILES} } from './util${(n + 1) % NOISE_FILES}';
const store = new Map<string, number>();
const client = { get: (url: string) => url, post: (url: string, body: unknown) => ({ url, body }), use: (fn: unknown) => fn };
export function helper${n}(input: string): string {
  let value = input.trim();
  value = value.toLowerCase();
  value = value.replace(/\\s+/g, '-');
  store.set(value, (store.get(value) ?? 0) + 1);
  client.get('/api/not-a-route/${n}');
  client.post('/api/not-a-route/${n}', { value });
  client.use(() => value);
  return value.length > 64 ? helper${(n + 1) % NOISE_FILES}(value.slice(0, 64)) : value;
}
export class Service${n} {
  private items: string[] = [];
  add(item: string) { this.items.push(helper${n}(item)); return this; }
  get(index: number) { return this.items[index]; }
  all() { return this.items.map((item, i) => \`\${i}:\${item}\`).filter(Boolean); }
}
`);
  }
  write('src/lib/generated.js', range(BIG_FUNCTIONS).map((i) =>
    `function f${i}(a, b) { return ${i ? `f${i - 1}(a, b) + ` : ''}f${(i * 7919) % BIG_FUNCTIONS}.length + Math.max(a, b, ${i}); }\n`).join('') +
    `module.exports = { ${range(50).map((i) => `f${i * 100}`).join(', ')} };\n`);
  write('src/lib/lexer.js', `module.exports = function lex(input) {
  var s = input;
  var out = [];
${range(LEXER_REASSIGNMENTS).map((i) => `  if (s.charCodeAt(0) === ${i % 128}) { out.push(s.slice(0, ${(i % 5) + 1})); s = s.slice(${(i % 5) + 1}); }`).join('\n')}
  return out;
};
`);

  // the app
  write('src/app.ts', `import express from 'express';
import * as resources from '@/routes';
import { mountControllers } from '@/controllers';
import { tableRouter } from '@/table';
import { deepRouter0 } from '@/deep/level0';
import { registerAll } from '@/register';

const app = express();
app.use(express.json());
${range(RESOURCES).map((n) => `app.use('/api/resource${n}', resources.resource${n}Router);`).join('\n')}
mountControllers(app);
app.use('/table', tableRouter);
app.use('/deep', deepRouter0);
registerAll(app);

export default app;
`);
  return EXPECTED_ROUTES;
}

module.exports = { generate, EXPECTED_ROUTES };
