import type { FastifyPluginAsync } from 'fastify';

const users: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', listUsers); // GET /users
  fastify.get('/:id', { schema: {} }, showUser); // GET /users/:id
  fastify.post('/', { handler: createUser }); // POST /users
  fastify.register(async (nested) => {
    nested.delete('/:id', removeUser); // DELETE /users/nested/:id
  }, { prefix: '/nested' });
};

export default users;
