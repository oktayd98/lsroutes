'use strict';
/**
 * Turns the apps and routers into table rows: full paths from the mount tree, split into groups.
 *
 * Grouping: one group per router and mount prefix (how the code is organized), split further by the first
 * static segment of the route's own path (`/users` and `/posts` on one router). Single-route segments of a
 * router share one group instead of a divider each.
 *
 * @param {import('../analysis/routers').RouterNode[]} routers
 * @returns {{ groups: string[][][], warnings: string[] }} rows are [method, path, handler, location]
 */
function buildReport(routers) {
  const rowsBySegmentByOwner = new Map(); // `router id|mount prefix` -> first path segment -> rows
  const addRow = (router, prefix, route) => {
    const owner = `${router.id}|${prefix}`;
    if (!rowsBySegmentByOwner.has(owner)) rowsBySegmentByOwner.set(owner, new Map());
    const rowsBySegment = rowsBySegmentByOwner.get(owner);
    const segment = resourceSegment(route.path);
    if (!rowsBySegment.has(segment)) rowsBySegment.set(segment, []);
    rowsBySegment.get(segment).push([route.method.toUpperCase(), joinPaths(prefix, route.path), route.handler, route.location]);
  };
  const visit = (router, prefix, ancestors) => {
    if (ancestors.has(router)) return; // a router mounted inside itself
    ancestors.add(router);
    for (const entry of router.entries) {
      if (entry.type === 'mount') visit(entry.router, joinPaths(prefix, entry.prefix), ancestors);
      else addRow(router, prefix, entry);
    }
    ancestors.delete(router);
  };

  const roots = routers.filter((router) => !router.mounted).sort((a, b) => appsFirst(a) - appsFirst(b));
  const hasApp = roots.some((router) => router.kind === 'app');
  const warnings = [];
  for (const root of roots) {
    if (hasApp && root.kind === 'router' && root.entries.length) {
      warnings.push(`warning: router at ${root.location} is not mounted on any app (or the mount could not be resolved); its paths are shown without a prefix`);
    }
    visit(root, '/', new Set());
  }
  return { groups: groupRows(rowsBySegmentByOwner), warnings };
}

const appsFirst = (router) => (router.kind === 'app' ? 0 : 1);

/** First static segment of a path: '/users/:id' -> 'users'. Parameters and patterns are not resources: ''. */
function resourceSegment(routePath) {
  const segment = routePath.split('/').find(Boolean) || '';
  return /^[:*{(/]/.test(segment) ? '' : segment;
}

function groupRows(rowsBySegmentByOwner) {
  const groups = [];
  for (const rowsBySegment of rowsBySegmentByOwner.values()) {
    let singles; // single-route segments of this router, collected into one group
    for (const rows of rowsBySegment.values()) {
      if (rows.length > 1 || rowsBySegment.size === 1) groups.push(rows);
      else if (singles) singles.push(...rows);
      else groups.push((singles = [...rows]));
    }
  }
  return groups;
}

/** '/api' + '/users/' -> '/api/users'; '/' + '/' -> '/' */
const joinPaths = (a, b) => ('/' + a + '/' + b).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

module.exports = { buildReport };
