'use strict';
// npm run bench: generates the synthetic project in the OS temp dir, checks lsroutes finds every endpoint,
// then reports median wall time of cold (--no-cache) and cached runs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { generate, EXPECTED_ROUTES } = require('./generate');

const RUNS = Number(process.env.RUNS) || 5;
const root = path.join(os.tmpdir(), 'lsroutes-bench-app');
const bin = path.join(__dirname, '../bin/lsroutes.js');

generate(root);

function run(args) {
  const start = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [bin, root, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  if (r.status !== 0) throw new Error(`lsroutes failed:\n${r.stderr}`);
  return { ms, stdout: r.stdout, stderr: r.stderr };
}
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// correctness first: a fast wrong answer is not a result
const check = run(['--no-cache']);
const found = Number(check.stdout.trim().split('\n').pop().split(' ')[0]);
if (found !== EXPECTED_ROUTES || check.stderr) {
  console.error(check.stderr);
  throw new Error(`expected ${EXPECTED_ROUTES} routes and no warnings, got ${found}`);
}

const cold = median([...Array(RUNS)].map(() => run(['--no-cache']).ms));
run([]); // fill the cache
const warm = median([...Array(RUNS)].map(() => run([]).ms));

let files = 0;
let lines = 0;
let bytes = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.[jt]s$/.test(e.name)) {
      const text = fs.readFileSync(p, 'utf8');
      files++;
      bytes += text.length;
      lines += text.split('\n').length;
    }
  }
})(root);

console.log(`project:  ${files} files, ${lines.toLocaleString('en-US')} lines, ${(bytes / 1e6).toFixed(1)} MB, ${found} routes`);
console.log(`cold:     ${Math.round(cold)} ms (median of ${RUNS}, --no-cache)`);
console.log(`cached:   ${Math.round(warm)} ms (median of ${RUNS})`);
console.log(`machine:  ${os.cpus()[0].model}, Node ${process.version}, ${os.platform()}`);
