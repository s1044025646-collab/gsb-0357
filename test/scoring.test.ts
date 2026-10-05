import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, nextState, validateAppend, ScoringError } from '../src/scoring';

// 手算参考：完整局总分
const cases: [string, number[], number][] = [
  ['全零', Array(20).fill(0), 0],
  ['每轮 9,0', Array(20).fill(0).map((_, i) => (i % 2 === 0 ? 9 : 0)), 90],
  ['十二次全倒', Array(12).fill(10), 300],
  ['全补中 5,5 加末球 5', [...Array(20).fill(5), 5], 150],
  ['混合示例', [1, 4, 4, 5, 6, 4, 5, 5, 10, 0, 1, 7, 3, 6, 4, 10, 2, 8, 6], 133],
  ['第十轮开放轮', [...Array(18).fill(0), 3, 4], 7],
  ['第十轮补中补一球', [...Array(18).fill(0), 4, 6, 7], 17],
  ['第十轮 X,7,3', [...Array(18).fill(0), 10, 7, 3], 20],
  ['第十轮 X,X,4', [...Array(18).fill(0), 10, 10, 4], 24],
];

for (const [name, pins, expected] of cases) {
  test(`手算核对: ${name} = ${expected}`, () => {
    const a = analyze(pins);
    assert.equal(a.complete, true);
    assert.equal(a.total, expected);
    assert.ok(a.total! >= 0 && a.total! <= 300);
    // 每一步都应是合法前缀
    for (let k = 0; k < pins.length; k++) {
      assert.doesNotThrow(() => validateAppend(pins.slice(0, k), pins[k]));
    }
    assert.equal(nextState(pins), null, '完整局后不应有下一球');
  });
}

test('普通轮计分与累计', () => {
  const a = analyze([3, 4, 2, 5]);
  assert.equal(a.frames[0].score, 7);
  assert.equal(a.frames[1].score, 7);
  assert.deepEqual(a.cumulative, [7, 14]);
  assert.equal(a.next?.frame, 3);
});

test('补中奖励引用下一球编号，未投时待定', () => {
  let a = analyze([4, 6]);
  assert.equal(a.frames[0].kind, 'spare');
  assert.equal(a.frames[0].score, null);
  assert.equal(a.frames[0].pending, true);
  assert.deepEqual(a.frames[0].bonusFrom, []);
  a = analyze([4, 6, 7]);
  assert.equal(a.frames[0].score, 17);
  assert.deepEqual(a.frames[0].bonusFrom, [3]);
  assert.equal(a.cumulative[0], 17);
  assert.equal(a.cumulative[1], null, '第二轮未完成，累计待定');
});

test('连续全倒：同一后续球参与多个前轮奖励，但只保存一次', () => {
  const a = analyze([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
  assert.equal(a.throwCount, 12);
  assert.equal(a.frames[0].score, 30);
  assert.deepEqual(a.frames[0].bonusFrom, [2, 3]);
  assert.deepEqual(a.frames[1].bonusFrom, [3, 4]);
  assert.equal(a.frames[8].score, 30);
  assert.equal(a.frames[9].score, 30);
  assert.equal(a.total, 300);
});

test('连续全倒中间状态：奖励待定不当作零', () => {
  const a = analyze([10, 10, 10]);
  assert.equal(a.frames[0].score, 30);
  assert.equal(a.frames[1].pending, true);
  assert.equal(a.frames[1].score, null);
  assert.equal(a.cumulative[0], 30);
  assert.equal(a.cumulative[1], null);
  assert.equal(a.total, null);
  assert.equal(a.complete, false);
});

test('第十轮各分支的下一球上限与摆瓶', () => {
  const prefix = Array(18).fill(0);
  assert.deepEqual(nextState([...prefix, 10, 7]), {
    frame: 10, maxPins: 3, standingPins: 3, rackReset: false,
  });
  assert.deepEqual(nextState([...prefix, 10, 10]), {
    frame: 10, maxPins: 10, standingPins: 10, rackReset: true,
  });
  assert.deepEqual(nextState([...prefix, 10]), {
    frame: 10, maxPins: 10, standingPins: 10, rackReset: true,
  });
  assert.deepEqual(nextState([...prefix, 4, 6]), {
    frame: 10, maxPins: 10, standingPins: 10, rackReset: true,
  });
  assert.equal(nextState([...prefix, 3, 4]), null, '开放轮两球即结束');
  assert.equal(nextState([...prefix, 10, 7, 3]), null);
});

test('未全倒时第二球不能超过剩余瓶数', () => {
  assert.throws(() => validateAppend([6], 5), (e: ScoringError) => e.code === 'EXCEEDS_REMAINING');
  assert.doesNotThrow(() => validateAppend([6], 4));
});

test('已结束的局拒绝额外投球', () => {
  const full = Array(12).fill(10);
  assert.throws(() => validateAppend(full, 1), (e: ScoringError) => e.code === 'GAME_FINISHED');
  const open10 = [...Array(18).fill(0), 3, 4];
  assert.throws(() => validateAppend(open10, 1), (e: ScoringError) => e.code === 'GAME_FINISHED');
});

test('非法瓶数被拒绝', () => {
  for (const bad of [-1, 11, 3.5, NaN]) {
    assert.throws(() => validateAppend([], bad), (e: ScoringError) => e.code === 'INVALID_PINS');
  }
});

test('零瓶局逐步可投且总分 0', () => {
  const pins: number[] = [];
  for (let k = 0; k < 20; k++) {
    validateAppend(pins, 0);
    pins.push(0);
  }
  assert.equal(analyze(pins).total, 0);
});
