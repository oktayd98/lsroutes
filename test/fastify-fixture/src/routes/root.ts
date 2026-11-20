export default async function (fastify) {
  fastify.get('/', rootHandler); // GET /api
}
