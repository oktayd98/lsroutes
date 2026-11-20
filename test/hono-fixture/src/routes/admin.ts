import { Hono } from 'hono';

const admin = new Hono();
const v1 = admin.basePath('/v1');
v1.get('/stats', stats); // GET /api/admin/v1/stats
admin.get('/ping', ping); // GET /api/admin/ping

export default admin;
