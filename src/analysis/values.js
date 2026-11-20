'use strict';
/**
 * Values: what an expression of the analyzed project can evaluate to.
 *
 * The resolver answers "what is this expression?" with a list of values, because one expression can have
 * several (`a || b`, or a parameter that gets different arguments at different call sites). An empty list
 * means unknown or not interesting. Values are plain objects tagged with a `kind`; this file is the one
 * place that lists every kind.
 */

const Kind = Object.freeze({
  EXPRESS: 'express', // the express module itself: express() creates an app
  ROUTER_FACTORY: 'routerFactory', // express.Router: calling it creates a router
  ROUTER: 'router', // an app or router instance, see routers.js
  ROUTE: 'route', // router.route('/path'): methods called on it add routes at that path
  STRING: 'string',
  FUNCTION: 'function',
  CLASS: 'class',
  INSTANCE: 'instance', // new SomeClass()
  MODULE: 'module', // a project file used as a namespace: import * as x, require('./x')
  ARRAY: 'array', // an array literal
  OBJECT: 'object', // an object literal
});

const EXPRESS = Object.freeze({ kind: Kind.EXPRESS });
const ROUTER_FACTORY = Object.freeze({ kind: Kind.ROUTER_FACTORY });

// Paths below are Babel NodePaths pointing at the code that defines the value.
const Value = {
  express: () => EXPRESS,
  routerFactory: () => ROUTER_FACTORY,
  router: (router) => ({ kind: Kind.ROUTER, router }),
  route: (router, path) => ({ kind: Kind.ROUTE, router, path }),
  string: (value) => ({ kind: Kind.STRING, value }),
  function: (declaration) => ({ kind: Kind.FUNCTION, declaration }),
  class: (declaration) => ({ kind: Kind.CLASS, declaration }),
  instance: (classDeclaration) => ({ kind: Kind.INSTANCE, classDeclaration }),
  module: (file) => ({ kind: Kind.MODULE, file }),
  array: (literal) => ({ kind: Kind.ARRAY, literal }),
  object: (literal) => ({ kind: Kind.OBJECT, literal }),
};

/** Values routes can be added to: an app or router, or the result of router.route(path). */
const isRouteTarget = (value) => value.kind === Kind.ROUTER || value.kind === Kind.ROUTE;

module.exports = { Kind, Value, isRouteTarget };
