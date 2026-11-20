'use strict';
const http = require('http');

/** Method names that define a route in Express-style APIs: get, post, ... (every HTTP method) and all. */
const ROUTE_METHODS = new Set([...http.METHODS.map((method) => method.toLowerCase()), 'all']);

module.exports = { ROUTE_METHODS };
