const express = require('express');
const router = express.Router();
const a = express.Router(); a.get('/a', h);
const b = express.Router(); b.get('/b', h);
[{ path: '/one', route: a }, { path: '/two', route: b }].forEach((r) => router.use(r.path, r.route));
for (const { path, route } of [{ path: '/three', route: a }]) router.use(path, route);
module.exports = router;
