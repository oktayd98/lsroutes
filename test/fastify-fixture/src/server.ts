import Fastify from 'fastify';
import fp from 'fastify-plugin';
import autoload from '@fastify/autoload';
import path from 'node:path';
import usersPlugin from './plugins/users';
import { registerAdmin } from './plugins/admin';

const app = Fastify({ logger: true }).withTypeProvider();

app.get('/health', async () => ({ ok: true })); // GET /health
app.route({ method: ['GET', 'HEAD'], url: '/status', handler: statusHandler }); // GET and HEAD /status
app.register(usersPlugin, { prefix: '/users' });
app.register(registerAdmin, { prefix: '/admin' });
// fastify-plugin: not encapsulated, the prefix option does not apply -> GET /shared
app.register(fp(async (instance) => { instance.get('/shared', sharedHandler); }), { prefix: '/ignored' });
app.register(import('./plugins/esm.js'), { prefix: '/esm' });
app.register(autoload, { dir: path.join(__dirname, 'routes'), routeParams: true, options: { prefix: '/api' } });

app.listen({ port: 3000 });
