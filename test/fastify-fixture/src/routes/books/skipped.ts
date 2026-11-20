// books/ has an index file, so autoload loads only that one (and subdirectories)
export default async function (fastify) { fastify.get('/never', neverHandler); }
