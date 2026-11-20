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
