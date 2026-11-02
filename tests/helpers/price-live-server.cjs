'use strict';
const path = require('node:path');
const { localStore } = require('../../common/lib/certificate-store');
const { start } = require('../../server');
start({ store: localStore(path.join(process.env.GC_VERIFY_DIR, 'store'), path.join(process.env.GC_VERIFY_DIR, 'results')), config: { port: 0, key: '', token: 'live-price-verification' } }).then(({ server }) => {
  process.send({ port: server.address().port });
  process.on('message', msg => { if (msg === 'stop') { server.close(() => process.exit(0)); server.closeAllConnections(); } });
}).catch(error => { process.send({ error: error.message }); process.exit(1); });
