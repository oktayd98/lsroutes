const express = require('express');
const { Router } = require('express');
function makeRouter() {
  const r = Router();
  r.delete('/cache', clearCache);
  return r;
}
const outer = express.Router();
outer.use('/admin', makeRouter());
module.exports = outer;
outer.use('/v1', require('./v1'));
