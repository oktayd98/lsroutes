import { Hono } from 'hono/quick';

export const posts = new Hono()
  .get('/', listPosts) // GET /api/posts
  .post('/', createPost); // POST /api/posts
