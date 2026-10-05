import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorecard, finalScore, computeState, ScoringError } from '../src/scoring';

test('普通开放轮：两球之和，无奖励', () => {
  const card = scorecard([3, 4]);
  assert.equal(card.frames[0].total, 7);
  assert.equal(card.frames[0].bonusNeeded, 0);
  assert.equal(card.cumulative[0], 7);
  assert.equal(card.next.frame, 2);
  assert.equal(card.next.maxPins, 10);
});

test('全零局 0 分，共 20 球', () => {
  const rolls = Array(20).fill(0);
  assert.equal(finalScore(rolls), 0);
  assert.equal(computeState(rolls).done, true);
});

test('每轮 9、0 共 90 分', () => {
  const rolls = Array(10).fill([9, 0]).flat();
  assert.equal(finalScore(rolls), 90);
});

test('十二次全倒 300 分，共 12 球', () => {
  const rolls = Array(12).fill(10);
  const card = scorecard(rolls);
  assert.equal(card.totalScore, 300);
  assert.equal(card.rollCount, 12);
  assert.deepEqual(card.cumulative[9], 300);
});

test('补中：10 加后一球，奖励引用正确球编号', () => {
  const card = scorecard([4, 6, 5, 3]);
  assert.equal(card.frames[0].total, 15);
  assert.deepEqual(card.frames[0].bonusFrom, [3]);
  assert.equal(card.frames[0].bonus, 5);
  assert.equal(card.cumulative[0], 15);
  assert.equal(card.cumulative[1], 23);
});

test('全倒：10 加后两球，同一后续球可参与不同前轮奖励', () => {
  const card = scorecard([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
  assert.deepEqual(card.frames[0].bonusFrom, [2, 3]);
  assert.deepEqual(card.frames[1].bonusFrom, [3, 4]); // 球 3 同时参与第 1、2 轮奖励
  assert.equal(card.rollCount, 12); // 但只保存为一次真实投球
});

test('连续全倒后奖励待定，总分为 null 而非按 0 计', () => {
  const card = scorecard([10, 10, 10]);
  assert.equal(card.frames[0].total, 30); // 球2、3 已投
  assert.equal(card.frames[1].pending, true); // 球 4 未投
  assert.equal(card.frames[1].total, null);
  assert.equal(card.cumulative[0], 30);
  assert.equal(card.cumulative[1], null); // 局部已结算与全局待定分开
  assert.equal(card.totalScore, null);
});

test('未全倒时第二球不能超过剩余瓶数', () => {
  assert.throws(() => scorecard([7, 4]), (e: ScoringError) => e.code === 'EXCEEDS_REMAINING');
  assert.throws(() => scorecard([0, 11]), (e: ScoringError) => e.code === 'INVALID_PINS');
});

test('第十轮 X、7 后下一球上限 3；X、X 后上限 10', () => {
  const prefix = Array(9).fill([0, 0]).flat();
  let st = computeState([...prefix, 10, 7]);
  assert.equal(st.maxPins, 3);
  assert.equal(st.rackReset, false);
  st = computeState([...prefix, 10, 10]);
  assert.equal(st.maxPins, 10);
  assert.equal(st.rackReset, true);
});

test('第十轮 X、7、3 合法；X、7、4 被拒绝', () => {
  const prefix = Array(9).fill([0, 0]).flat();
  assert.doesNotThrow(() => scorecard([...prefix, 10, 7, 3]));
  assert.throws(() => scorecard([...prefix, 10, 7, 4]), (e: ScoringError) => e.code === 'EXCEEDS_REMAINING');
});

test('第十轮补中只补一球并摆满', () => {
  const prefix = Array(9).fill([0, 0]).flat();
  const st = computeState([...prefix, 4, 6]);
  assert.equal(st.maxPins, 10);
  assert.equal(st.ballInFrame, 3);
  const card = scorecard([...prefix, 4, 6, 10]);
  assert.equal(card.complete, true);
  assert.equal(card.frames[9].total, 20);
});

test('第十轮开放轮无补投，结束后拒绝额外投球', () => {
  const prefix = Array(9).fill([0, 0]).flat();
  const rolls = [...prefix, 3, 4];
  assert.equal(computeState(rolls).done, true);
  assert.throws(() => scorecard([...rolls, 1]), (e: ScoringError) => e.code === 'GAME_OVER');
});

test('满分局结束后拒绝第 13 球', () => {
  assert.throws(() => scorecard(Array(13).fill(10)), (e: ScoringError) => e.code === 'GAME_OVER');
});

test('手算核对：混合局逐轮分数与累计', () => {
  // 序列: X | 7/ | 9- | X | -8 | 8/ | -6 | X | X | X81
  const rolls = [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1];
  // 手算: 20, 19, 9, 18, 8, 10, 6, 30, 28, 19 → 累计 20,39,48,66,74,84,90,120,148,167
  const card = scorecard(rolls);
  assert.equal(card.totalScore, 167);
  assert.deepEqual(card.cumulative, [20, 39, 48, 66, 74, 84, 90, 120, 148, 167]);
  assert.deepEqual(card.frames[0].bonusFrom, [2, 3]);
  assert.deepEqual(card.frames[1].bonusFrom, [4]);
  assert.deepEqual(card.frames[3].bonusFrom, [7, 8]);
  assert.deepEqual(card.frames[5].bonusFrom, [11]);
  assert.deepEqual(card.frames[7].bonusFrom, [14, 15]);
  assert.deepEqual(card.frames[8].bonusFrom, [15, 16]);
  assert.equal(card.frames[9].total, 19);
});

test('有效完整局总分在 0..300 且投球数符合规则', () => {
  const cases: number[][] = [
    Array(20).fill(0),
    Array(12).fill(10),
    Array(10).fill([9, 0]).flat(),
    Array(10).fill([5, 5]).flat().concat([5]), // 全部补中
  ];
  for (const rolls of cases) {
    const card = scorecard(rolls);
    assert.ok(card.complete);
    assert.ok(card.totalScore! >= 0 && card.totalScore! <= 300);
    assert.ok(card.rollCount >= 12 && card.rollCount <= 21);
  }
  assert.equal(finalScore(Array(10).fill([5, 5]).flat().concat([5])), 150);
});
