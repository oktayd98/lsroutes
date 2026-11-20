'use strict';
const http = require('http');

/** Methods that define a route on an Express app or router: get, post, ..., and all. */
const ROUTE_METHODS = new Set([...http.METHODS.map((method) => method.toLowerCase()), 'all']);

/**
 * An Express app (`express()`) or router (`Router()`) found in the analyzed code, with the routes defined
 * on it and the routers mounted on it, in the order they were found.
 */
class RouterNode {
  constructor(id, kind, location) {
    this.id = id;
    this.kind = kind; // 'app' or 'router'
    this.location = location; // "file:line" where it is created
    this.entries = []; // { type: 'route', method, path, handler, location } | { type: 'mount', router, prefix }
    this.mounted = false; // true once another app or router mounts it with use()
  }

  addRoute({ method, path, handler, location }) {
    this.entries.push({ type: 'route', method, path, handler, location });
  }

  mount(router, prefix) {
    this.entries.push({ type: 'mount', router, prefix });
    router.mounted = true;
  }
}

/**
 * Every app and router of the project, keyed by the expression that creates it: all references to one
 * `Router()` call share one RouterNode.
 */
class RouterRegistry {
  constructor(project) {
    this.project = project;
    this.byCreation = new Map(); // creation node -> RouterNode
  }

  /** The app or router created by the expression at `creationPath`. */
  at(kind, creationPath) {
    let router = this.byCreation.get(creationPath.node);
    if (!router) {
      router = new RouterNode(this.byCreation.size, kind, this.project.location(creationPath));
      this.byCreation.set(creationPath.node, router);
    }
    return router;
  }

  all() {
    return [...this.byCreation.values()];
  }
}

module.exports = { ROUTE_METHODS, RouterNode, RouterRegistry };
