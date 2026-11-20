'use strict';
/**
 * lsroutes: lists the routes of an Express, Fastify, NestJS or Hono project by static analysis. Nothing from the project is executed.
 *
 *   files      find the source files            project/files.js
 *   parse      parse them, resolve imports       project/project.js, project/pathAliases.js
 *   collect    find routes, routers and mounts   analysis/collector.js, with analysis/resolver.js answering
 *                                                "what is this expression?" for every argument and receiver,
 *                                                and frameworks/ giving each framework's API its meaning
 *   report     full paths, groups, warnings      report/groups.js
 */
const fs = require('fs');
const path = require('path');
const { findProjectFiles, isConfigFile } = require('./project/files');
const { Project } = require('./project/project');
const { Resolver } = require('./analysis/resolver');
const { createFrameworks } = require('./frameworks');
const { RouteCollector } = require('./analysis/collector');
const { buildReport } = require('./report/groups');
const { cacheKey, readCache, writeCache } = require('./cache');

/**
 * @param {string} root absolute path of the project directory
 * @param {{ cache?: boolean }} [options]
 * @returns {{ groups: string[][][], warnings: string[], cached: boolean }} groups of [method, path, handler, location]
 *   rows; `cached` when the result comes from the cache
 */
function listRoutes(root, { cache = true } = {}) {
  const filePaths = findProjectFiles(root);
  const contents = filePaths.map((filePath) => fs.readFileSync(filePath, 'utf8'));
  const key = cacheKey(filePaths, contents);
  const cached = cache && readCache(root, key);
  if (cached) return { ...cached, cached: true };

  const result = analyze(root, filePaths, contents);
  writeCache(root, key, result);
  return { ...result, cached: false };
}

function analyze(root, filePaths, contents) {
  const project = new Project(root);
  filePaths.forEach((filePath, i) => {
    if (!isConfigFile(path.basename(filePath))) project.addSource(filePath, contents[i]);
  });
  const resolver = new Resolver(project, createFrameworks());
  new RouteCollector(resolver).collect();
  const report = buildReport(resolver.routers.all());
  return { groups: report.groups, warnings: [...project.warnings, ...report.warnings] };
}

module.exports = { listRoutes };
