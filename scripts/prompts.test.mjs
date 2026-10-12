import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('initialize declares prompts, prompts/list is empty, and every tool input has a description', async (t) => {
  process.env.TOKENLAB_API_BASE = 'http://127.0.0.1:9';
  const { createHttpApp } = await import('../src/server.ts');
  const server = createHttpApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const client = new Client({ name: 'prompts-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`)));
  t.after(async () => { await client.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });

  const capabilities = client.getServerCapabilities();
  assert.ok(capabilities.prompts, 'prompts capability is declared');
  assert.ok(capabilities.tools, 'tools capability is still declared');
  assert.deepEqual(await client.listPrompts(), { prompts: [] });
  await assert.rejects(client.getPrompt({ name: 'missing' }), /not found/);

  const { tools } = await client.listTools();
  assert.equal(tools.length, 3);
  for (const tool of tools) {
    for (const [name, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
      assert.equal(typeof schema.description, 'string', `${tool.name}.${name} has a description`);
      assert.ok(schema.description.length > 10, `${tool.name}.${name} description is a sentence`);
    }
  }
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool.inputSchema]));
  assert.deepEqual(Object.keys(byName.open_tokenlab_model_explorer.properties).sort(), ['category', 'query']);
  assert.deepEqual(byName.compare_tokenlab_models.required, ['models']);
  assert.equal(byName.compare_tokenlab_models.properties.models.minItems, 1);
  assert.equal(byName.compare_tokenlab_models.properties.models.maxItems, 8);
  assert.equal(byName.generate_tokenlab_endpoint_example.properties.model.default, 'gpt-5.5');
  assert.deepEqual(byName.generate_tokenlab_endpoint_example.properties.endpoint.enum, ['chat_completions', 'responses', 'anthropic_messages', 'gemini_generate_content', 'systemone']);
});
