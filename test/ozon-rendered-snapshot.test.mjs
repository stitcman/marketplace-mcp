import assert from 'node:assert/strict';import {normalizeRenderedSnapshot} from '../scripts/normalize-ozon-rendered-snapshot.mjs';
const op=id=>({method_id:id,text:'Title\nPOST\n/v1/'+id+'\nREQUEST BODY SCHEMA: application/json\nlimit\ninteger <= 100',closed_schema_nodes:0});
const family={family:'seller',source:'https://docs.ozon.ru/api/seller/',retrieved_at_utc:'2026-10-01T00:00:00Z',operations:[op('b'),op('a'),op('a')]};const a=normalizeRenderedSnapshot([family]);const b=normalizeRenderedSnapshot([{...family,retrieved_at_utc:'2026-10-01T01:00:00Z',operations:[op('a'),op('b'),op('a')]}]);assert.equal(a.normalized_content_sha256,b.normalized_content_sha256);assert.equal(a.counts.total,2);assert.equal(a.duplicates.length,1);assert.equal(a.duplicates[0].identical,true);assert.throws(()=>normalizeRenderedSnapshot([{...family,source:'https://third-party.invalid'}]),/OFFICIAL_SOURCE/);console.log('PASS deterministic official rendered material hashing, duplicate accounting, source validation');

import {schemaFromRenderedFields} from "../scripts/ozon-rendered-contracts.mjs";
const schema=schemaFromRenderedFields([{name:"filter",required:true,material:"object",children:[{name:"ids",required:true,material:"Array of strings <int64> [ 1 .. 100 ] items",children:[]}]}]);
assert.deepEqual(schema.required,["filter"]);assert.deepEqual(schema.properties.filter.required,["ids"]);assert.equal(schema.properties.filter.properties.ids.maxItems,100);assert.equal(schema.properties.ids,undefined);assert.throws(()=>schemaFromRenderedFields(["[MaxDepth]"]),/Lossy/);
console.log("PASS nested official input schema generation");
const bounded=schemaFromRenderedFields([{name:'limit',required:true,material:'integer <int64>',description:'Минимум — 20, максимум — 100.',children:[]},{name:'ids',required:false,material:'Array of strings',description:'Можно передавать до 1000 значений.',children:[]}]);
assert.equal(bounded.properties.limit.minimum,20);assert.equal(bounded.properties.limit.maximum,100);assert.equal(bounded.properties.ids.maxItems,1000);
console.log('PASS constraints from official field descriptions');
