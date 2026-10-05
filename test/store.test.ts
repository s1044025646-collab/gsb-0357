import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Store, StoreError } from '../src/store';
import { analyze } from '../src/scoring';

function memStore(): Store {
  return new Store(':memory:');
}

function tmpDb(): { db: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bowling-'));
  return {
    db: path.join(dir, 'g.db'),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('批量录入原子性：半批不合法则整批回滚', () => {
  const s = memStore();
  const g = s.createGame();
  s.appendThrows(g.id, [3, 4]);
  assert.throws(
    () => s.appendThrows(g.id, [6, 5]), // 第二球超剩余
    (e: { code: string }) => e.code === 'EXCEEDS_REMAINING'
  );
  assert.deepEqual(s.getThrows(g.id), [3, 4], '失败的批量不能留下半批');
  assert.equal(s.getGameRow(g.id).version, 1, '版本号不应前进');
});

test('版本号冲突被拒绝', () => {
  const s = memStore();
  const g = s.createGame();
  s.appendThrows(g.id, [1, 2], 0);
  assert.throws(
    () => s.appendThrows(g.id, [3], 0),
    (e: StoreError) => e.code === 'VERSION_CONFLICT'
  );
  s.appendThrows(g.id, [3], 1);
  assert.deepEqual(s.getThrows(g.id), [1, 2, 3]);
});

test('撤销最后一球后可重投，分数从序列重新核算', () => {
  const s = memStore();
  const g = s.createGame();
  s.appendThrows(g.id, [10, 3]);
  let a = s.undoLast(g.id);
  assert.equal(a.frames[0].pending, true, '撤销奖励球后回到待定');
  a = s.appendThrows(g.id, [7, 2]);
  assert.equal(a.frames[0].score, 19, '10+7+2 重新核算');
  assert.deepEqual(s.getThrows(g.id), [10, 7, 2]);
});

test('重启后继续：新 Store 实例读取同一文件', () => {
  const { db, cleanup } = tmpDb();
  let s = new Store(db);
  const g = s.createGame();
  s.appendThrows(g.id, [10, 10, 10]);
  const version = s.getGameRow(g.id).version;
  s.close();
  s = new Store(db); // 模拟重启
  assert.deepEqual(s.getThrows(g.id), [10, 10, 10]);
  assert.equal(s.getGameRow(g.id).version, version);
  const a = s.appendThrows(g.id, [4, 5]);
  assert.equal(a.frames[0].score, 30); // 10+10+10
  assert.equal(a.frames[1].score, 24); // 10+10+4
  assert.equal(a.frames[2].score, 19); // 10+4+5
  s.close();
  cleanup();
});

test('已结束的局重启后保持最终总分并拒绝投球', () => {
  const { db, cleanup } = tmpDb();
  let s = new Store(db);
  const g = s.createGame();
  s.appendThrows(g.id, Array(12).fill(10));
  s.close();
  s = new Store(db);
  const card = s.scorecard(g.id);
  assert.equal(card.analysis.total, 300);
  assert.throws(
    () => s.appendThrows(g.id, [1]),
    (e: { code: string }) => e.code === 'GAME_FINISHED'
  );
  s.close();
  cleanup();
});

test('导入导出投球序列一致', () => {
  const s = memStore();
  const pins = [1, 4, 4, 5, 6, 4, 5, 5, 10, 0, 1, 7, 3, 6, 4, 10, 2, 8, 6];
  const { game } = s.importThrows(pins);
  assert.deepEqual(s.getThrows(game.id), pins);
  assert.equal(s.scorecard(game.id).analysis.total, 133);
});

test('事件日志记录每次状态转换', () => {
  const s = memStore();
  const g = s.createGame();
  s.appendThrows(g.id, [3, 4]);
  s.undoLast(g.id);
  const events = s.getEvents(g.id) as { type: string; version: number }[];
  assert.deepEqual(events.map((e) => e.type), ['create', 'append', 'undo']);
  assert.deepEqual(events.map((e) => e.version), [0, 1, 2]);
});

test('前九轮奖励引用球编号核对（逐球录入与整局分析一致）', () => {
  const s = memStore();
  const g = s.createGame();
  const pins = [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1];
  let last = analyze([]);
  for (const p of pins) last = s.appendThrows(g.id, [p]);
  const direct = analyze(pins);
  assert.deepEqual(last, direct);
  assert.equal(direct.total, 167);
  assert.deepEqual(direct.frames[0].bonusFrom, [2, 3]);
  assert.deepEqual(direct.frames[1].bonusFrom, [4]);
  assert.deepEqual(direct.frames[3].bonusFrom, [7, 8]);
});
