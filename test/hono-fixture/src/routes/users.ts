import { Hono } from 'hono';

const users = new Hono();
users.get('/', (c) => c.json([])); // GET /api/users
users.get('/:id', showUser); // GET /api/users/:id
users.delete('/:id', authMiddleware, deleteUser); // DELETE /api/users/:id

export default users;
