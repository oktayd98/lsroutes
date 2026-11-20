import express from 'express';
import users from './routes/users';
import { postsRouter } from './routes';
import registerHealth from './health';
import axios from 'axios';

const API = '/api/v1';
const app = express();
app.use(express.json());
app.use(`${API}/users`, users);
app.use(API, postsRouter);
app.use('/legacy', require('./legacy'));
registerHealth(app);
app.get('env');
app.get('/', (req, res) => res.send('ok'));
axios.get('/not/a/route');
export default app;
// path aliases from tsconfig.json (extends tsconfig.base.json); imports are hoisted, so this is valid at the bottom
import comments from '@/routes/comments'; // @/routes/* -> src/aliased/comments.ts (would be src/routes/... via @/*)
import notes from '@/aliased/comments'; // @/* -> src/aliased/comments.ts
import tags from '@tags'; // exact key
app.use('/api/comments', comments);
app.use('/api/notes', notes);
app.use('/api/tags', tags);
import { createReplayRouter } from './routes/replays';
const registerReplays = (deps: { app: typeof app }) => deps.app.use('/api', createReplayRouter({ now: Date.now }));
registerReplays({ app });
