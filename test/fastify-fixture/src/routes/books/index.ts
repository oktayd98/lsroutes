export default async function (fastify) {
  fastify.get('/', listBooks); // GET /api/books
}
