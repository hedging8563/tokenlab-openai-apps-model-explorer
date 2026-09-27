import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { createHttpApp } from '../src/server.ts';

const html = await readFile(new URL('../huggingface/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

async function explorer() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerHTML: '', disabled: false, events: {}, addEventListener(name, callback) { this.events[name] = callback; } });
    return elements.get(id);
  };
  const models = Array.from({ length: 321 }, (_, index) => ({ id: `model-${String(index).padStart(3, '0')}`, tokenlab: { category: index === 320 ? 'decision' : 'chat' } }));
  const context = vm.createContext({ AbortSignal, setTimeout, location: { pathname: '/widget' }, document: { getElementById: element, querySelectorAll: () => [] }, fetch: async url => ({ ok: true, json: async () => ({ data: url.endsWith('/v1/models') ? models : [] }) }) });
  vm.runInContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  return { context, element };
}

test('all 321 models are reachable beyond the previous 200-row cap', async () => {
  const { element } = await explorer();
  assert.match(element('status').textContent, /1–50 of 321/);
  assert.equal(element('previous').disabled, true);
  for (let i = 0; i < 6; i++) element('next').events.click();
  assert.match(element('status').textContent, /301–321 of 321/);
  assert.match(element('models').innerHTML, /model-320/);
  assert.equal(element('next').disabled, true);
  element('previous').events.click();
  assert.match(element('status').textContent, /251–300 of 321/);
});

test('search and categories filter the entire catalog and reset the page', async () => {
  const { element } = await explorer();
  element('next').events.click();
  element('query').value = 'model-320';
  element('query').events.input();
  assert.match(element('status').textContent, /1–1 of 1 matching models · 321/);
  assert.match(element('models').innerHTML, /model-320/);
  element('query').value = '';
  element('category').value = 'decision';
  element('category').events.change();
  assert.match(element('models').innerHTML, /model-320/);
  element('query').value = 'missing';
  element('query').events.input();
  assert.match(element('status').textContent, /No matching models · 321/);
  assert.equal(element('next').disabled, true);
  assert.equal(element('previous').disabled, true);
});

test('failed refresh stays an error and can recover; model text is escaped', async () => {
  const { element, context } = await explorer();
  const healthyFetch = context.fetch;
  context.fetch = async () => { throw new Error('offline'); };
  await element('refresh').events.click();
  assert.match(element('status').textContent, /Could not load public data: offline/);
  assert.equal(element('query').disabled, true);
  assert.equal(element('refresh').disabled, false);
  context.fetch = healthyFetch;
  await element('refresh').events.click();
  assert.equal(element('query').disabled, false);
  vm.runInContext(`state.models = [{id:'<img onerror=alert(1)>',category:'chat'}]; render();`, context);
  assert.doesNotMatch(element('models').innerHTML, /<img /);
  assert.match(element('models').innerHTML, /&lt;img/);
});

test('standalone widget serves the same complete directory as the HF Space', async t => {
  const server = createHttpApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/widget`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), html);
});
