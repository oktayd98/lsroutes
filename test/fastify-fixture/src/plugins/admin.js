module.exports.registerAdmin = async function (server) {
  server.route({ method: 'POST', url: '/reindex', handler: async () => {} }); // POST /admin/reindex
};
