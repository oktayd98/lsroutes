// never registered: its parameter is not a Fastify instance, so nothing here is a route
export default async (f) => { f.get('/orphan', orphanHandler); };
