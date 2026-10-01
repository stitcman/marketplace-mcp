import assert from 'node:assert/strict';
import { MarketplaceReadTransport } from '../src/core/genericReadTransport.js';
import { requireReadMethod } from '../src/core/readPolicies.js';
const original=globalThis.fetch;
try {
  globalThis.fetch=async()=>new Response('{"accruals":[{"accrual_id":9007199254740993123,"total_amount":{"amount":"9007199254740993.01","currency":"RUB"}}],"last_id":""}',{headers:{'content-type':'application/json'}});
  const data:any=await new MarketplaceReadTransport().send({marketplace:'ozon',connectionId:'synthetic-exact-id',method:requireReadMethod('ozon','GetFinanceAccrualByDay'),params:{date:'2026-09-30',last_id:''},credentials:{client_id:'synthetic',api_key:'synthetic'}});
  assert.equal(data.accruals[0].accrual_id,'9007199254740993123');
  assert.equal(data.accruals[0].total_amount.amount,'9007199254740993.01');
  console.log('PASS exact int64 accrual identity and decimal money; synthetic READ transport only');
} finally {globalThis.fetch=original;}
