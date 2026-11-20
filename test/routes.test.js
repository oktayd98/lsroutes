const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('lists routes of the fixture project', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '../bin/lsroutes.js'), path.join(__dirname, 'fixture')], { encoding: 'utf8', timeout: 10000, env: { ...process.env, FORCE_COLOR: '', NO_COLOR: '1' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /router at src\/orphan\.ts:2 is not mounted/);
  assert.strictEqual(r.stdout, `\
┌────────┬──────────────────────────┬───────────────────┬───────────────────────────┐
│ Method │ Path                     │ Handler           │ Source                    │
├────────┼──────────────────────────┼───────────────────┼───────────────────────────┤
│ GET    │ /api/v1/users            │ ctrl.list         │ src/routes/users.ts:5     │
│ GET    │ /api/v1/users/:id        │ ctrl.show         │ src/routes/users.ts:6     │
│ PUT    │ /api/v1/users/:id/avatar │ ctrl.upload       │ src/routes/users.ts:7     │
│ DELETE │ /api/v1/users/:id/avatar │ ctrl.removeAvatar │ src/routes/users.ts:7     │
├────────┼──────────────────────────┼───────────────────┼───────────────────────────┤
│ POST   │ /api/v1/posts            │ function          │ src/routes/posts.ts:3     │
│ POST   │ /api/v1/articles         │ function          │ src/routes/posts.ts:3     │
├────────┼──────────────────────────┼───────────────────┼───────────────────────────┤
│ DELETE │ /legacy/admin/cache      │ clearCache        │ src/legacy.js:5           │
├────────┼──────────────────────────┼───────────────────┼───────────────────────────┤
│ GET    │ /legacy/v1/one/a         │ h                 │ src/v1.js:3               │
├────────┼──────────────────────────┼───────────────────┼───────────────────────────┤
│ GET    │ /legacy/v1/two/b         │ h                 │ src/v1.js:4               │
├────────┼──────────────────────────┼───────────────────┼───────────────────────────┤
│ GET    │ /legacy/v1/three/a       │ h                 │ src/v1.js:3               │
├────────┼──────────────────────────┼───────────────────┼───────────────────────────┤
│ GET    │ /                        │ function          │ src/app.ts:15             │
│ GET    │ /health                  │ function          │ src/health.js:2           │
├────────┼──────────────────────────┼───────────────────┼───────────────────────────┤
│ GET    │ /api/comments            │ listComments      │ src/aliased/comments.ts:3 │
├────────┼──────────────────────────┼───────────────────┼───────────────────────────┤
│ GET    │ /api/notes               │ listComments      │ src/aliased/comments.ts:3 │
├────────┼──────────────────────────┼───────────────────┼───────────────────────────┤
│ GET    │ /api/tags                │ listTags          │ src/routes/tags.ts:3      │
├────────┼──────────────────────────┼───────────────────┼───────────────────────────┤
│ GET    │ /api/replays/:id         │ showReplay        │ src/routes/replays.ts:4   │
├────────┼──────────────────────────┼───────────────────┼───────────────────────────┤
│ GET    │ /v2/me                   │ UserController#me │ src/server2.ts:4          │
├────────┼──────────────────────────┼───────────────────┼───────────────────────────┤
│ PATCH  │ /lonely                  │ h                 │ src/orphan.ts:3           │
└────────┴──────────────────────────┴───────────────────┴───────────────────────────┘
18 routes
`);
});

test('cache is invalidated when files change, are added or removed', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsroutes-test-'));
  const run = () => spawnSync(process.execPath, [path.join(__dirname, '../bin/lsroutes.js'), dir], { encoding: 'utf8', timeout: 10000, env: { ...process.env, NO_COLOR: '1' } }).stdout;
  try {
    fs.writeFileSync(path.join(dir, 'app.js'), "const app = require('express')();\napp.get('/one', h);\n");
    assert.match(run(), /\/one/);
    assert.match(run(), /\/one/); // served from cache
    fs.writeFileSync(path.join(dir, 'app.js'), "const app = require('express')();\napp.get('/two', h);\n");
    assert.doesNotMatch(run(), /\/one/);
    fs.writeFileSync(path.join(dir, 'extra.js'), "const app = require('express')();\napp.post('/three', h);\n");
    assert.match(run(), /\/three/);
    fs.rmSync(path.join(dir, 'extra.js'));
    assert.doesNotMatch(run(), /\/three/);
    // alias target changes only in tsconfig.json: must not be served from cache
    fs.mkdirSync(path.join(dir, 'a'));
    fs.mkdirSync(path.join(dir, 'b'));
    fs.writeFileSync(path.join(dir, 'a/r.js'), "const r = require('express').Router();\nr.get('/from-a', h);\nmodule.exports = r;\n");
    fs.writeFileSync(path.join(dir, 'b/r.js'), "const r = require('express').Router();\nr.get('/from-b', h);\nmodule.exports = r;\n");
    fs.writeFileSync(path.join(dir, 'app.js'), "const app = require('express')();\napp.use('/x', require('~/r'));\n");
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{ "compilerOptions": { "paths": { "~/*": ["a/*"] } } }');
    assert.match(run(), /\/x\/from-a/);
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{ "compilerOptions": { "paths": { "~/*": ["b/*"] } } }');
    assert.match(run(), /\/x\/from-b/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('long value chains through unrelated code do not overflow the stack', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsroutes-test-'));
  try {
    // register(app) needs param tracing, which builds the call-site index over every file; there, a ring of
    // helpers passing their argument to the next one (util0 -> util1 -> ... -> util0) used to recurse ~6 frames
    // per file and overflowed the stack at ~800 files
    fs.writeFileSync(path.join(dir, 'app.js'), "const app = require('express')();\nfunction register(a) { a.get('/ok', h); }\nregister(app);\n");
    const n = 1000;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      fs.writeFileSync(path.join(dir, `util${i}.js`), `const { helper${j} } = require('./util${j}');
exports.helper${i} = function (input) {
  let value = input.trim();
  value = value.toLowerCase();
  return value.length > 64 ? helper${j}(value.slice(0, 64)) : value;
};
`);
    }
    const r = spawnSync(process.execPath, [path.join(__dirname, '../bin/lsroutes.js'), dir, '--no-cache'], { encoding: 'utf8', timeout: 20000, env: { ...process.env, NO_COLOR: '1' } });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /\/ok/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--help, --version and unknown options', () => {
  const cli = (...args) => spawnSync(process.execPath, [path.join(__dirname, '../bin/lsroutes.js'), ...args], { encoding: 'utf8' });
  for (const flag of ['--help', '-h']) {
    const r = cli(flag);
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /^Usage: lsroutes \[dir\] \[options\]/);
  }
  for (const flag of ['--version', '-v']) assert.strictEqual(cli(flag).stdout.trim(), require('../package.json').version);
  const r = cli('--no-cahce');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /unknown option --no-cahce/);
});

test('--color and --no-color override terminal detection and env vars', () => {
  const cli = (args, env) => spawnSync(process.execPath, [path.join(__dirname, '../bin/lsroutes.js'), path.join(__dirname, 'fixture'), ...args],
    { encoding: 'utf8', env: { ...process.env, NO_COLOR: '', FORCE_COLOR: '', ...env } }).stdout;
  const ESC = '\x1b[';
  assert.ok(!cli([]).includes(ESC), 'piped output is plain by default');
  assert.ok(cli(['--color']).includes(ESC), '--color forces colors when piped');
  assert.ok(cli(['--color'], { NO_COLOR: '1' }).includes(ESC), '--color beats NO_COLOR');
  assert.ok(!cli(['--no-color'], { FORCE_COLOR: '1' }).includes(ESC), '--no-color beats FORCE_COLOR');
  assert.ok(!cli(['--color', '--no-color']).includes(ESC), 'last flag wins');
});

test('arrays that spread themselves do not recurse forever', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const cli = (dir) => spawnSync(process.execPath, [path.join(__dirname, '../bin/lsroutes.js'), dir, '--no-cache'], { encoding: 'utf8', timeout: 20000, env: { ...process.env, NO_COLOR: '1' } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsroutes-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'app.js'), `const express = require('express');
const app = express();
const users = express.Router();
users.get('/', list);
let routers = [];
routers = [...routers, users];
routers.forEach((r) => app.use('/users', r));
`);
    const r = cli(dir);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /GET\s+│ \/users\s/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // lsroutes' own source hit the same bug through `[...resolve(a), ...resolve(b)]`
  const own = cli(path.join(__dirname, '../bin'));
  assert.strictEqual(own.status, 0, own.stderr);
  assert.strictEqual(own.stdout, 'No routes found.\n');
});

test('lists routes of the Fastify fixture project', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '../bin/lsroutes.js'), path.join(__dirname, 'fastify-fixture'), '--no-cache'], { encoding: 'utf8', timeout: 10000, env: { ...process.env, FORCE_COLOR: '', NO_COLOR: '1' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stderr, '');
  // every expected route is commented next to its declaration in test/fastify-fixture
  assert.strictEqual(r.stdout, `\
┌────────┬───────────────────┬───────────────┬─────────────────────────────────┐
│ Method │ Path              │ Handler       │ Source                          │
├────────┼───────────────────┼───────────────┼─────────────────────────────────┤
│ GET    │ /health           │ function      │ src/server.ts:10                │
├────────┼───────────────────┼───────────────┼─────────────────────────────────┤
│ GET    │ /status           │ statusHandler │ src/server.ts:11                │
│ HEAD   │ /status           │ statusHandler │ src/server.ts:11                │
├────────┼───────────────────┼───────────────┼─────────────────────────────────┤
│ GET    │ /users            │ listUsers     │ src/plugins/users.ts:4          │
│ GET    │ /users/:id        │ showUser      │ src/plugins/users.ts:5          │
│ POST   │ /users            │ createUser    │ src/plugins/users.ts:6          │
├────────┼───────────────────┼───────────────┼─────────────────────────────────┤
│ DELETE │ /users/nested/:id │ removeUser    │ src/plugins/users.ts:8          │
├────────┼───────────────────┼───────────────┼─────────────────────────────────┤
│ POST   │ /admin/reindex    │ function      │ src/plugins/admin.js:2          │
├────────┼───────────────────┼───────────────┼─────────────────────────────────┤
│ GET    │ /shared           │ sharedHandler │ src/server.ts:15                │
├────────┼───────────────────┼───────────────┼─────────────────────────────────┤
│ PUT    │ /esm/item         │ putItem       │ src/plugins/esm.js:2            │
├────────┼───────────────────┼───────────────┼─────────────────────────────────┤
│ GET    │ /api/custom/x     │ customHandler │ src/routes/custom.ts:3          │
├────────┼───────────────────┼───────────────┼─────────────────────────────────┤
│ GET    │ /api              │ rootHandler   │ src/routes/root.ts:2            │
├────────┼───────────────────┼───────────────┼─────────────────────────────────┤
│ GET    │ /api/books/:id    │ showBook      │ src/routes/books/_id/index.ts:2 │
├────────┼───────────────────┼───────────────┼─────────────────────────────────┤
│ GET    │ /api/books        │ listBooks     │ src/routes/books/index.ts:2     │
└────────┴───────────────────┴───────────────┴─────────────────────────────────┘
14 routes
`);
});
