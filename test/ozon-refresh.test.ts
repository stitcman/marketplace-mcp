import assert from 'node:assert/strict';
import { MemoryStore } from '../src/core/store.js';
import { registerOzonTools } from '../src/adapters/ozon/tools.js';
import { OzonClient } from '../src/adapters/ozon/client.js';

const store = new MemoryStore();
const conn = await store.addConnection({ marketplace: 'ozon', name: 'synthetic refresh', status: 'active', mock: false, sandbox: false, permissions: ['prices.read', 'stocks.read', 'orders.read'] }, { client_id: 'synthetic', api_key: 'synthetic' });
const tools = new Map<string, { config: any; handler: any }>();
registerOzonTools({ registerTool(name: string, config: any, handler: any) { tools.set(name, { config, handler }); } } as any, store);
let calls: {path: string; body: any}[] = [];
let reply: (path: string, body: any) => unknown = () => ({});
const original = OzonClient.prototype.request;
OzonClient.prototype.request = async function(path: string, body: any) { calls.push({path, body}); return reply(path, body) as any; };
async function call(name: string, args: any = {}) {
  const result = await tools.get(name)!.handler({connection_id: conn.connection_id, limit: 1, ...args});
  const payload = JSON.parse(result.content[0].text);
  if (payload.success) {
    const { z } = await import('zod');
    z.object(tools.get(name)!.config.outputSchema).parse(payload);
  }
  return payload;
}
let failures = 0;
async function check(name: string, run: () => Promise<void>) {
  if (process.argv[2] === '--pagination' && !/cursor pages|filtered empty/.test(name)) return;
  try { calls = []; await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${(error as Error).message}`); }
}
try {
  for (const name of ['ozon_prices_get', 'ozon_stocks_get']) {
    await check(`${name}: cursor pages, totals independent, terminal and repetition`, async () => {
      reply = () => ({items: [{product_id: 101, offer_id: 'synthetic', price: {price: '1.25'}, stocks: [{type: 'fbs', present: 2, reserved: 0}]}], cursor: 'page-2', total_items: 19});
      const first = await call(name);
      assert.equal(first.success, true);
      assert.equal(calls[0].body.cursor, '');
      assert.equal('last_id' in calls[0].body, false);
      assert.equal(first.data.has_more, true);
      assert.equal(first.data.next_cursor, first.meta.next_cursor);
      reply = () => ({items: [], cursor: 'page-3', total_items: 2});
      const second = await call(name, {cursor: first.data.next_cursor, limit: 7});
      assert.equal(calls[1].body.cursor, 'page-2');
      assert.equal(second.data.has_more, true, 'upstream cursor survives an empty page');
      const repeated = await call(name, {cursor: second.data.next_cursor});
      assert.equal(repeated.data.has_more, false);
      reply = () => ({items: [], cursor: ''});
      assert.equal((await call(name)).data.has_more, false);
    });
  }
  await check('stocks: filtered empty page retains continuation', async () => {
    reply = () => ({items: [{product_id: 101, stocks: [{type: 'fbo', present: 0, reserved: 0}]}], cursor: 'next'});
    const result = await call('ozon_stocks_get', {fulfillment_model: 'FBS'});
    assert.deepEqual(result.data.items, []);
    assert.equal(result.data.has_more, true);
  });
  await check('stocks: v2 preserves rFBS, FBP, unknown and missing; v1 refuses incompatible rows', async () => {
    reply = () => ({items: [{product_id: 101, stocks: [{type: 'fbo', present: 0, reserved: 0}, {type: 'fbs', present: 206, reserved: 1}, {type: 'rfbs', present: 6}, {type: 'fbp'}, {type: 'new_type'}]}], cursor: ''});
    const result = await call('ozon_stocks_get', {contract_version: 'v2'});
    assert.equal(result.success, true);
    assert.deepEqual(result.data.items.map((s: any) => s.fulfillment_model), ['FBO', 'FBS', 'rFBS', 'FBP', 'UNKNOWN']);
    assert.equal(result.data.items[2].reserved, null);
    assert.equal(result.data.items[3].available, null);
    assert.equal(result.data.items[4].source_type, 'new_type');
    const legacy = await call('ozon_stocks_get');
    assert.equal(legacy.success, false);
    assert.equal(legacy.error.code, 'FEATURE_NOT_SUPPORTED');
  });
  await check('prices: declared price preserves missing, null and zero', async () => {
    for (const value of [undefined, null, '0']) {
      reply = () => ({items: [{product_id: 101, price: {price: '1.25', ...(value === undefined ? {} : {declared_price: value})}}], cursor: ''});
      const result = await call('ozon_prices_get');
      assert.deepEqual(result.data.items[0].declared_price, value === undefined ? undefined : value === null ? null : {amount: value, currency: 'RUB'});
    }
  });
  await check('orders: FBS v4 root response, exact money, independent terminal streams and fixed window', async () => {
    reply = (path) => path === '/v2/posting/fbo/list' ? {result: [{posting_number: 'FBO-SYNTH', products: [{sku: 555, quantity: 1, price: '1.00'}]}]}
      : {postings: [{posting_number: 'FBS-SYNTH', products: [{sku: 777, offer_id: 'synthetic', quantity: 3, price: {amount: '90071992547409.93', currency: 'RUB'}}]}], cursor: 'fbs-next', has_next: true};
    const first = await call('ozon_orders_list', {fulfillment_model: 'all', date_from: '2026-09-30T00:00:00Z'});
    assert.equal(first.success, true);
    assert.equal(calls[1].path, '/v4/posting/fbs/list');
    assert.equal(calls[1].body.sort_dir, 'DESC');
    assert.equal(calls[1].body.cursor, '');
    assert.equal(first.data.items[1].amount.amount, '270215977642229.79');
    assert.equal(first.data.items[1].amount.currency, 'RUB');
    assert.equal(first.data.items[1].marketplace_product_id, null, 'sku is not product_id');
    assert.equal(first.data.items[1].source_sku, '777');
    const end = calls[1].body.filter.to;
    reply = (path) => path === '/v2/posting/fbo/list' ? {result: []} : {postings: [], cursor: '', has_next: false};
    const second = await call('ozon_orders_list', {fulfillment_model: 'all', date_from: '2026-09-30T00:00:00Z', cursor: first.data.next_cursor});
    assert.equal(second.success, true);
    assert.equal(calls[3].body.cursor, 'fbs-next');
    assert.equal(calls[3].body.filter.to, end);
    assert.equal(second.data.has_more, false);
    const count = calls.length;
    const mismatch = await call('ozon_orders_list', {fulfillment_model: 'FBS', cursor: first.data.next_cursor});
    assert.equal(mismatch.success, false);
    assert.equal(calls.length, count, 'incompatible cursor sends no HTTP');
  });
} finally { OzonClient.prototype.request = original; }
if (failures) process.exitCode = 1;
