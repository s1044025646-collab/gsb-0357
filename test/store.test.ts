import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Store, StoreError } from '../src/store';

let dir: string;
let store: Store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bowling-'));
  store = new Store(path.join(dir, 'test.db'));
});

afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('批量录入失败整体回滚，不留半批', () => {
  const g = store.createGame();
  store.appendRolls(g.id, [3, 4]);
  assert.throws(
    () => store.appendRolls(g.id, [5, 5, 5, 99]), // 最后一球非法
    (e: StoreError) => e.code === 'INVALID_PINS',
  );
  assert.deepEqual(store.getRolls(g.id), [3, 4]); // 未留下半批
});

test('版本号乐观锁：过期版本追加返回 VERSION_CONFLICT', () => {
  const g = store.createGame();
  store.appendRolls(g.id, [1, 1], 0);
  assert.throws(
    () => store.appendRolls(g.id, [2], 0),
    (e: StoreError) => e.code === 'VERSION_CONFLICT',
  );
  store.appendRolls(g.id, [2], 1); // 正确版本可追加
  assert.deepEqual(store.getRolls(g.id), [1, 1, 2]);
});

test('撤销最后一球后可重投，分数从序列重新核算', () => {
  const g = store.createGame();
  store.appendRolls(g.id, [10, 3]);
  store.undoLast(g.id);
  const card = store.appendRolls(g.id, [7, 3]);
  assert.deepEqual(store.getRolls(g.id), [10, 7, 3]);
  assert.equal(card.frames[0].total, 20); // 10 + 7 + 3
});

test('重启后未结束的局可继续录入，已结束的局保持最终总分', () => {
  const g1 = store.createGame();
  store.appendRolls(g1.id, [10, 10]);
  const g2 = store.createGame();
  store.appendRolls(g2.id, Array(12).fill(10));
  store.close();

  store = new Store(path.join(dir, 'test.db')); // 模拟重启
  assert.equal(store.scorecard(g1.id).next.frame, 3);
  store.appendRolls(g1.id, [10]);
  assert.equal(store.scorecard(g1.id).frames[0].total, 30);
  const g2row = store.getGame(g2.id);
  assert.equal(g2row.finished, 1);
  assert.equal(g2row.final_score, 300);
  assert.throws(() => store.appendRolls(g2.id, [1]), (e: StoreError) => e.code === 'GAME_OVER');
});

test('导出与导入投球序列', () => {
  const rolls = [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1];
  const g = store.createGame();
  store.appendRolls(g.id, rolls);
  assert.deepEqual(store.getRolls(g.id), rolls);
  const imported = store.importGame(rolls);
  assert.equal(imported.card.totalScore, 167);
});

test('导入非法序列被拒绝', () => {
  assert.throws(() => store.importGame([7, 8]), (e: StoreError) => e.code === 'EXCEEDS_REMAINING');
  assert.throws(() => store.importGame(Array(13).fill(10)), (e: StoreError) => e.code === 'GAME_OVER');
});
