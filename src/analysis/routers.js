'use strict';

/**
 * An app, router or plugin instance found in the analyzed code (`express()`, `Router()`, a Fastify plugin),
 * with the routes defined on it and the routers mounted on it, in the order they were found.
 */
class RouterNode {
  constructor(id, framework, kind, location) {
    this.id = id;
    this.framework = framework; // name of the adapter that interprets calls on it, see frameworks/
    this.kind = kind; // 'app' (a root), 'router' or 'plugin'
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

  /** The app or router created by the code at `creationPath` (a call, or a Fastify plugin function). */
  at(framework, kind, creationPath) {
    let router = this.byCreation.get(creationPath.node);
    if (!router) {
      router = new RouterNode(this.byCreation.size, framework, kind, this.project.location(creationPath));
      this.byCreation.set(creationPath.node, router);
    }
    return router;
  }

  all() {
    return [...this.byCreation.values()];
  }
}

module.exports = { RouterNode, RouterRegistry };
