// autoload applies hooks from this file; it is not a plugin, so this is not a route
export default async function (fastify) { fastify.get('/from-hooks', hooksHandler); }
