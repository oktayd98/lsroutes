import { Hono } from 'hono';
import { logger } from 'hono/logger';
import users from './routes/users';
import { posts } from './routes/posts';
import admin from './routes/admin';

const app = new Hono().basePath('/api');

app.use(logger());
app.get('/health', (c) => c.text('ok')); // GET /api/health

app
  .get('/items', listItems) // GET /api/items
  .post(createItem); // POST /api/items (reuses the previous path)

app.on('PURGE', '/cache', purgeCache); // PURGE /api/cache
app.on(['PUT', 'DELETE'], ['/a', '/b'], both); // PUT and DELETE on /api/a and /api/b

const routes = app.route('/users', users).route('/posts', posts); // under /api/users and /api/posts
app.route('/admin', admin); // under /api/admin/v1 (admin has its own base path)

export default app;
export type AppType = typeof routes;
