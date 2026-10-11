import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CATALOG_MAX_AGE_MS, createCatalogReader } from '../src/catalog.ts';

const price = (input, output) => ({ input_per_1m: input, output_per_1m: output, per_request: null, is_lock_price: false, currency: 'USD' });
const live = [
  ...Array.from({ length: 58 }, (_, i) => ({ id: `video-${i}`, owned_by: 'v', tokenlab: { category: 'video', pricing_unit: 'per_second', pricing: { ...price(null, null), per_request: '0.5' }, providers: ['vp'] } })),
  ...Array.from({ length: 30 }, (_, i) => ({ id: `chat-${i}`, tokenlab: { category: 'chat', pricing: price('1', '2') } })),
  { id: 'gpt-5.5', owned_by: 'openai', tokenlab: { category: 'chat', pricing_unit: 'per_token', max_input_tokens: 1050000, max_output_tokens: 128000, capabilities: ['tool-use', 'vision'], providers: ['openai'], pricing: price('1.5', '9') } },
  { id: 'claude-sonnet-5-5', tokenlab: { category: 'chat', max_input_tokens: 1000000, capabilities: ['reasoning'], providers: ['anthropic'], pricing: price('0.6', '3') } },
];

async function startApi() {
  const state = { requests: [], down: false };
  const api = createServer((req, res) => {
    state.requests.push(req.url);
    if (state.down) { res.writeHead(503); res.end('down'); return; }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') { res.end(JSON.stringify({ object: 'list', data: live })); return; }
    if (req.url === '/v1/models/gpt-5.5') { res.end(JSON.stringify({ id: 'gpt-5.5', tokenlab: { accepted_request_formats: ['openai_chat_completions'] } })); return; }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  return { api, state, base: `http://127.0.0.1:${api.address().port}` };
}

test('tools read the live catalog: full category counts, live prices with currency and read time, explicit errors', async (t) => {
  const { api, state, base } = await startApi();
  t.after(() => new Promise((resolve) => api.close(resolve)));
  process.env.TOKENLAB_API_BASE = base;
  const dir = await mkdtemp(path.join(tmpdir(), 'challenge-'));
  process.env.OPENAI_APPS_CHALLENGE_FILE = path.join(dir, 'missing.txt');
  delete process.env.OPENAI_APPS_CHALLENGE_TOKEN;
  const { createHttpApp } = await import('../src/server.ts');
  const server = createHttpApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({ name: 'catalog-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));
  t.after(async () => { await client.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['compare_tokenlab_models', 'generate_tokenlab_endpoint_example', 'open_tokenlab_model_explorer']);
  for (const tool of tools) assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, tool.name);

  const video = await client.callTool({ name: 'open_tokenlab_model_explorer', arguments: { category: 'video' } });
  assert.equal(video.structuredContent.models.length, 58);
  assert.equal(video.structuredContent.total, 58);
  assert.equal(video.structuredContent.categories.video, 58);
  assert.match(video.structuredContent.catalog_fetched_at, /^\d{4}-\d\d-\d\dT/);
  for (const model of video.structuredContent.models) {
    assert.equal(model.pricing.currency, 'USD');
    assert.equal(model.per_request, '0.5');
    assert.equal(model.price_fetched_at, video.structuredContent.catalog_fetched_at);
  }
  const text = await client.callTool({ name: 'open_tokenlab_model_explorer', arguments: { category: 'text' } });
  assert.equal(text.structuredContent.models.length, 32);

  const compared = await client.callTool({ name: 'compare_tokenlab_models', arguments: { models: ['gpt-5.5', 'claude-sonnet-5-5', 'nope'] } });
  const [gpt, claude] = compared.structuredContent.models;
  assert.deepEqual([gpt.id, gpt.pricing.input_per_1m, gpt.pricing.output_per_1m, gpt.pricing.currency, gpt.max_input_tokens, gpt.provider], ['gpt-5.5', '1.5', '9', 'USD', 1050000, 'openai']);
  assert.deepEqual(gpt.capabilities, ['tool-use', 'vision']);
  assert.deepEqual([claude.id, claude.input_per_1m, claude.output_per_1m], ['claude-sonnet-5-5', '0.6', '3']);
  assert.deepEqual(compared.structuredContent.missing, ['nope']);

  const example = await client.callTool({ name: 'generate_tokenlab_endpoint_example', arguments: { endpoint: 'chat_completions', model: 'gpt-5.5' } });
  assert.ok(!example.isError);
  assert.equal(example.structuredContent.models[0].pricing.currency, 'USD');

  // No top-up or purchase links in any tool output, and the old static price file is not read.
  const outputs = JSON.stringify([video, text, compared, example]);
  assert.doesNotMatch(outputs, /top[- ]?up|recharge|billing|checkout|purchase|buy|\/pricing\.json/i);
  assert.ok(!state.requests.includes('/pricing.json'));
  // One catalog read served every call (server cache).
  assert.equal(state.requests.filter((url) => url === '/v1/models').length, 1);

  // Domain verification: 404 unconfigured, then the file, then the env var.
  assert.equal((await fetch(`${origin}/.well-known/openai-apps-challenge`)).status, 404);
  process.env.OPENAI_APPS_CHALLENGE_FILE = path.join(dir, 'token.txt');
  await writeFile(process.env.OPENAI_APPS_CHALLENGE_FILE, 'file-token-123\n');
  let res = await fetch(`${origin}/.well-known/openai-apps-challenge`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  assert.equal(await res.text(), 'file-token-123');
  process.env.OPENAI_APPS_CHALLENGE_TOKEN = 'env-token-456';
  res = await fetch(`${origin}/.well-known/openai-apps-challenge`);
  assert.equal(await res.text(), 'env-token-456');
  delete process.env.OPENAI_APPS_CHALLENGE_TOKEN;
});

test('cache lasts at most 10 minutes and never hides a failed refresh behind an old snapshot', async (t) => {
  const { api, state, base } = await startApi();
  t.after(() => new Promise((resolve) => api.close(resolve)));
  let clock = Date.parse('2026-10-12T00:00:00Z');
  const read = createCatalogReader({ apiBase: base, maxAgeMs: 60 * 60 * 1000, now: () => clock });

  state.down = true;
  await assert.rejects(read(), /live model catalog is unavailable.*HTTP 503/);
  state.down = false;
  const first = await read();
  assert.equal(first.fetched_at, '2026-10-12T00:00:00.000Z');
  assert.equal(first.models.length, live.length);

  clock += CATALOG_MAX_AGE_MS - 1000; // even when asked for an hour, the cap is 10 minutes
  assert.equal(await read(), first);
  assert.equal(state.requests.filter((url) => url === '/v1/models').length, 2);
  clock += 2000;
  const second = await read();
  assert.notEqual(second, first);
  assert.equal(state.requests.filter((url) => url === '/v1/models').length, 3);

  state.down = true;
  clock += CATALOG_MAX_AGE_MS + 1;
  await assert.rejects(read(), /unavailable/);
});

test('a failed refresh inside the 10-minute window serves the recent copy with its read time', async (t) => {
  const { api, state, base } = await startApi();
  t.after(() => new Promise((resolve) => api.close(resolve)));
  let clock = Date.parse('2026-10-12T00:00:00Z');
  const read = createCatalogReader({ apiBase: base, maxAgeMs: 60 * 1000, now: () => clock });
  const first = await read();
  state.down = true;
  clock += 5 * 60 * 1000;
  const again = await read();
  assert.equal(again.fetched_at, first.fetched_at);
});
