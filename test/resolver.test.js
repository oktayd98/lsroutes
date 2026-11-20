const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Resolver } = require('../src/analysis/resolver');

test('a cyclic question graph is computed once per node, not once per path', { timeout: 5000 }, () => {
  // every node depends on every other one, like services passing `log` to each other: without the provisional
  // cache, results cut by a cycle are recomputed on every path, about n! computations
  const resolver = new Resolver({}, {});
  const n = 12;
  let computations = 0;
  const ask = (i) => resolver.guard(`node${i}`, () => {
    computations++;
    const reached = [i];
    for (let j = 0; j < n; j++) if (j !== i) reached.push(...ask(j));
    return [...new Set(reached)];
  });
  assert.deepStrictEqual(ask(0).sort((a, b) => a - b), [...Array(n).keys()]);
  assert.ok(computations <= n, `${computations} computations`);
});

test('partial results of a cycle are not kept after the question is answered', () => {
  // resolving b's `y` meets a's `x` mid-cycle; if that partial answer were memoized for good, routes on `y`
  // reached later from a different starting point would be lost
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsroutes-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'app.js'), `const app = require('express')();
function a(x, n) { if (n) b(x, n - 1); x.get('/from-a', h); }
function b(y, n) { a(y, n); y.get('/from-b', h); }
a(app, 3);
`);
    const r = spawnSync(process.execPath, [path.join(__dirname, '../bin/lsroutes.js'), dir, '--no-cache'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /\/from-a/);
    assert.match(r.stdout, /\/from-b/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('calls ruled out from file summaries still find every caller that can reach a route', () => {
  // each route below is reached through a path the summary-based pruning must keep (see Resolver.callersOf)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsroutes-test-'));
  const write = (name, code) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), code);
  };
  try {
    write('app.ts', `import express from 'express';
import { users } from './routes';
import table from './table';
import { mount } from './mount';
import { mountLegacy } from './legacy-mount';
const app = express();
users(app);
mountLegacy(app);
table.forEach((register) => register(app));
mount(app);
const config = { get() {} };
config.get('port', 80);
`);
    write('routes/index.ts', "export { default as users } from './users';\nexport * from './other';\n");
    write('routes/users.ts', "export default function (app) { app.get('/barrel-renamed', h); }\n");
    write('routes/other.ts', 'export const unrelated = 1;\n');
    // its own file: calls of app.ts are indexed anyway for the other routes, which would hide a missed require()
    write('legacy-mount.js', "exports.mountLegacy = (app) => {\n  require('./legacy')(app);\n  const required = require('./required');\n  required(app);\n};\n");
    write('legacy.js', "module.exports = (app) => { app.get('/require-call', h); };\n");
    write('required.js', "module.exports = (app) => { app.get('/required-variable', h); };\n");
    write('table.ts', "import posts from './posts';\nexport default [posts];\n");
    write('posts.ts', "export default (app) => { app.get('/exported-array', h); };\n");
    write('mount.ts', "import { helper } from './helper';\nexport function mount(app) { helper(app); }\n");
    write('helper.ts', "export function helper(app) { app.get('/two-levels', h); }\n");
    const r = spawnSync(process.execPath, [path.join(__dirname, '../bin/lsroutes.js'), dir, '--no-cache'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stderr, '');
    for (const route of ['/barrel-renamed', '/require-call', '/required-variable', '/exported-array', '/two-levels']) {
      assert.match(r.stdout, new RegExp(`GET +│ ${route} `));
    }
    assert.match(r.stdout, /5 routes/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
