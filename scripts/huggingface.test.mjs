import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

test('static explorer keeps decision categories and generates only declared endpoints', async () => {
  const html = await readFile(new URL('../huggingface/index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements = new Map();
  const context = vm.createContext({
    AbortSignal, setTimeout, location: { pathname: '/' },
    document: { getElementById: id => { if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '', addEventListener() {} }); return elements.get(id); }, querySelectorAll: () => [] },
    fetch: async url => ({ ok: true, json: async () => url.includes('/v1/models/') ? { id: 'jev-1.13', tokenlab: { accepted_request_formats: [], public_contract: { public_operations: ['systemone'], request_endpoint: '/v1/systemone' } } } : { data: [] } }),
  });
  vm.runInContext(script, context);
  assert.equal(vm.runInContext(`flattenModels({data:[{id:'jev-1.13',tokenlab:{category:'decision'}}]})[0].category`, context), 'decision');
  const example = await vm.runInContext(`endpointExample('jev-1.13')`, context);
  assert.match(example, /\/v1\/systemone/);
  assert.match(example, /"questions"/);
  assert.doesNotMatch(example, /"messages"|"stream"/);
  context.fetch = async () => ({ ok: true, json: async () => ({ tokenlab: { accepted_request_formats: [], public_contract: { public_operations: ['image_generation'] } } }) });
  assert.doesNotMatch(await vm.runInContext(`endpointExample('image-model')`, context), /curl|chat\/completions/);
});
