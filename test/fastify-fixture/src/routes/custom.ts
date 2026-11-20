export const autoPrefix = '/custom'; // replaces the directory prefix -> /api/custom
export default async function (fastify) {
  fastify.get('/x', customHandler); // GET /api/custom/x
}
