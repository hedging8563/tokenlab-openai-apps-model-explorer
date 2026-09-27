import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('explorer discovers decisions and validates operation contracts without inference', async t => {
  const requests = [];
  const credentials = [];
  let unavailable = false;
  const api = createServer((req, res) => {
    requests.push(req.url);
    credentials.push(req.headers.authorization, req.headers.cookie);
    if (unavailable) { res.writeHead(503); res.end('Unavailable'); return; }
    res.setHeader('Content-Type', 'application/json');
    const model = { id: 'jev-1.13', tokenlab: { category: 'decision', accepted_request_formats: [], public_contract: { public_operations: ['systemone'], request_endpoint: '/v1/systemone' } } };
    res.end(JSON.stringify(req.url === '/v1/models' ? { data: [model, { id: 'chat-test', tokenlab: { category: 'chat' } }] } : req.url.startsWith('/v1/models/') ? model : { data: [] }));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => api.close(resolve)));
  process.env.TOKENLAB_API_BASE = `http://127.0.0.1:${api.address().port}`;
  const { createHttpApp } = await import('../src/server.ts');
  const server = createHttpApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const client = new Client({ name: 'explorer-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`)));
  t.after(async () => {
    await client.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const listing = await client.callTool({ name: 'open_tokenlab_model_explorer', arguments: { category: 'decision' } });
  assert.deepEqual(listing.structuredContent.models.map(m => [m.id, m.category]), [['jev-1.13', 'decision']]);
  const example = await client.callTool({ name: 'generate_tokenlab_endpoint_example', arguments: { endpoint: 'systemone', model: 'jev-1.13' } });
  assert.ok(!example.isError);
  assert.match(example.structuredContent.example, /\/v1\/systemone/);
  assert.match(example.structuredContent.example, /"questions"/);
  assert.doesNotMatch(example.structuredContent.example, /"messages"|"stream"/);
  const wrong = await client.callTool({ name: 'generate_tokenlab_endpoint_example', arguments: { endpoint: 'chat_completions', model: 'jev-1.13' } });
  assert.equal(wrong.isError, true);
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const pathname of ['/v1/models', '/pricing.json', '/v1/models/jev-1.13', '/v1/models/provider%2Fmodel']) {
    const result = await fetch(`${origin}/public${pathname}`, { headers: { Authorization: 'Bearer must-not-forward', Cookie: 'private=must-not-forward' } });
    assert.equal(result.status, 200);
    assert.match(result.headers.get('cache-control'), /max-age=15/);
    await result.json();
    assert.equal(requests.at(-1), pathname);
  }
  assert.ok(credentials.every(value => value === undefined));
  assert.equal((await fetch(`${origin}/public/v1/chat/completions`, { method: 'POST' })).status, 404);
  unavailable = true;
  const failed = await fetch(`${origin}/public/v1/models`);
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: 'Public discovery endpoint unavailable' });
  unavailable = false;
  assert.equal((await fetch(`${origin}/public/v1/models`)).status, 200);
  assert.ok(requests.every(path => path === '/pricing.json' || path.startsWith('/v1/models')));
});
