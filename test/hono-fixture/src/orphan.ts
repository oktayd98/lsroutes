import { Hono } from 'hono';

// never mounted: listed without a prefix
const orphan = new Hono();
orphan.patch('/lonely', h); // PATCH /lonely
