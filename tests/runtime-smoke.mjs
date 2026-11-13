import { createServer, preview } from 'vite';
import assert from 'node:assert/strict';
for (const mode of ['dev', 'preview']) {
  const server = mode === 'dev' ? await createServer({ server: { port: 5201, host: '127.0.0.1' } }) : await preview({ preview: { port: 5202, host: '127.0.0.1' } });
  try {
    if (mode === 'dev') await server.listen();
    const port = mode === 'dev' ? 5201 : 5202;
    const base = 'http://127.0.0.1:' + port;
    assert.equal((await fetch(base)).status, 200);
    assert.ok((await (await fetch(base + '/api/session')).json()).token);
    assert.equal((await fetch(base + '/api/launch-fivem', { method: 'POST' })).status, 403);
    console.log(mode + ': HTML 200, session API works, unauthorized launch 403');
  } finally {
    if (mode === 'dev') { await server.environments.client.depsOptimizer?.scanProcessing; await server.close(); }
    else await new Promise(resolve => { server.httpServer.closeAllConnections(); server.httpServer.close(resolve); });
  }
}

