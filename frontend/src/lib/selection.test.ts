import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { selectItems } from './selection.ts';
test('多选、取消和跨方向范围选择遵循当前可见顺序', () => {
  const order = ['a','b','c','d'];
  assert.deepEqual(selectItems(order,['a'],'c','a',true,false),['a','c']);
  assert.deepEqual(selectItems(order,['a','c'],'a','c',true,false),['c']);
  assert.deepEqual(selectItems(order,['d'],'b','d',false,true),['b','c','d']);
  assert.deepEqual(selectItems(order,['d'],'b','missing',false,true),['b']);
  assert.deepEqual(selectItems(order,['a'],'d','c',true,true),['a','c','d']);
});
