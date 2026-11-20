export default async function (fastify) {
  fastify.get('/', showBook); // routeParams: _id -> GET /api/books/:id
}
