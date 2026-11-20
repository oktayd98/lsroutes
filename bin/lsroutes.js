#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { HELP, parseOptions, shouldUseColor } = require('../src/cli/options');
const { renderTable } = require('../src/cli/table');
const { listRoutes } = require('../src');

const options = parseOptions(process.argv.slice(2));

if (options.help) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (options.version) {
  console.log(require('../package.json').version);
  process.exit(0);
}
if (options.unknownOption) fail(`unknown option ${options.unknownOption}`);

const root = path.resolve(options.dir || '.');
if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) fail(`${options.dir} is not a directory`);

const { groups, warnings } = listRoutes(root, { cache: options.cache });
for (const warning of warnings) console.error(warning);
if (!groups.length) console.log('No Express routes found.');
else process.stdout.write(renderTable(groups, { color: shouldUseColor(options.colorFlag, process.env, process.stdout) }));

function fail(message) {
  console.error(`lsroutes: ${message}\nRun 'lsroutes --help' for usage.`);
  process.exit(1);
}
