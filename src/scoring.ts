// 十瓶保龄球逐球计分核心引擎（纯函数，无 IO）。
// 所有投球用 1 起始的全局编号（throwIndex）引用，奖励报告引用这些编号。

export interface FrameScore {
  frame: number; // 1..10
  throws: number[]; // 本轮真实投球的瓶数
  throwIndexes: number[]; // 本轮投球的全局编号（1 起始）
  kind: 'strike' | 'spare' | 'open' | 'incomplete';
  score: number | null; // null 表示待定（奖励球不足）
  pending: boolean;
  bonusFrom: number[]; // 奖励分引用的全局投球编号
}

export interface NextThrow {
  frame: number; // 当前轮次 1..10
  maxPins: number; // 下一球可投上限
  standingPins: number; // 当前剩余瓶数
  rackReset: boolean; // 下一球是否为重新摆满的一球
}

export interface Analysis {
  frames: FrameScore[];
  complete: boolean;
  total: number | null; // 全部轮次结算后才给出
  cumulative: (number | null)[]; // 每轮结束时的累计分，未确定处为 null
  next: NextThrow | null; // 局已结束为 null
  throwCount: number;
}

export class ScoringError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export function assertValidPins(pins: unknown): asserts pins is number {
  if (typeof pins !== 'number' || !Number.isInteger(pins) || pins < 0 || pins > 10) {
    throw new ScoringError('INVALID_PINS', `投球瓶数必须是 0..10 的整数，收到: ${String(pins)}`);
  }
}

// 计算给定投球序列下，下一球的状态（轮次、上限、摆瓶）。
export function nextState(throws: number[]): NextThrow | null {
  let i = 0;
  for (let frame = 1; frame <= 9; frame++) {
    if (i >= throws.length) {
      return { frame, maxPins: 10, standingPins: 10, rackReset: true };
    }
    const first = throws[i];
    if (first === 10) {
      i += 1;
      continue;
    }
    if (i + 1 >= throws.length) {
      return { frame, maxPins: 10 - first, standingPins: 10 - first, rackReset: false };
    }
    i += 2;
  }
  // 第十轮
  const t = throws.slice(i);
  if (t.length === 0) return { frame: 10, maxPins: 10, standingPins: 10, rackReset: true };
  const a = t[0];
  const b = t[1];
  if (a === 10) {
    if (t.length === 1) return { frame: 10, maxPins: 10, standingPins: 10, rackReset: true };
    if (b === 10) {
      if (t.length === 2) return { frame: 10, maxPins: 10, standingPins: 10, rackReset: true };
      return null;
    }
    if (t.length === 2) {
      return { frame: 10, maxPins: 10 - b, standingPins: 10 - b, rackReset: false };
    }
    return null;
  }
  if (t.length === 1) return { frame: 10, maxPins: 10 - a, standingPins: 10 - a, rackReset: false };
  if (a + b === 10) {
    if (t.length === 2) return { frame: 10, maxPins: 10, standingPins: 10, rackReset: true };
    return null;
  }
  return null; // 开放轮，两球结束
}

// 校验在既有序列上追加一球是否合法。
export function validateAppend(throws: number[], pins: number): void {
  assertValidPins(pins);
  const st = nextState(throws);
  if (st === null) {
    throw new ScoringError('GAME_FINISHED', '本局已结束，拒绝额外投球');
  }
  if (pins > st.maxPins) {
    throw new ScoringError(
      'EXCEEDS_REMAINING',
      `第 ${st.frame} 轮当前剩余 ${st.standingPins} 瓶，本球最多 ${st.maxPins}，收到 ${pins}`
    );
  }
}

export function analyze(throws: number[]): Analysis {
  const frames: FrameScore[] = [];
  const cumulative: (number | null)[] = [];
  let i = 0;
  let running = 0;
  let blocked = false; // 之前轮次存在待定，累计分不再给出

  for (let frame = 1; frame <= 9; frame++) {
    if (i >= throws.length) break;
    const a = throws[i];
    if (a === 10) {
      const b1 = throws[i + 1];
      const b2 = throws[i + 2];
      const bonusFrom: number[] = [];
      if (b1 !== undefined) bonusFrom.push(i + 2);
      if (b2 !== undefined) bonusFrom.push(i + 3);
      const pending = b1 === undefined || b2 === undefined;
      const score = pending ? null : 10 + b1 + b2;
      frames.push({
        frame, throws: [a], throwIndexes: [i + 1], kind: 'strike',
        score, pending, bonusFrom,
      });
      i += 1;
    } else {
      const b = throws[i + 1];
      if (b === undefined) {
        frames.push({
          frame, throws: [a], throwIndexes: [i + 1], kind: 'incomplete',
          score: null, pending: true, bonusFrom: [],
        });
        i += 1;
      } else if (a + b === 10) {
        const bn = throws[i + 2];
        const bonusFrom = bn === undefined ? [] : [i + 3];
        const pending = bn === undefined;
        frames.push({
          frame, throws: [a, b], throwIndexes: [i + 1, i + 2], kind: 'spare',
          score: pending ? null : 10 + bn, pending, bonusFrom,
        });
        i += 2;
      } else {
        frames.push({
          frame, throws: [a, b], throwIndexes: [i + 1, i + 2], kind: 'open',
          score: a + b, pending: false, bonusFrom: [],
        });
        i += 2;
      }
    }
  }

  // 第十轮
  if (frames.length === 9 && i < throws.length) {
    const t = throws.slice(i);
    const indexes = t.map((_, k) => i + k + 1);
    const done = nextState(throws) === null;
    let kind: FrameScore['kind'] = 'open';
    if (t[0] === 10) kind = 'strike';
    else if (t.length >= 2 && t[0] + t[1] === 10) kind = 'spare';
    if (!done && kind === 'open') kind = 'incomplete';
    frames.push({
      frame: 10, throws: t, throwIndexes: indexes, kind,
      score: done ? t.reduce((s, v) => s + v, 0) : null,
      pending: !done, bonusFrom: [],
    });
  }

  for (const f of frames) {
    if (blocked || f.pending || f.score === null) {
      cumulative.push(null);
      blocked = true;
    } else {
      running += f.score;
      cumulative.push(running);
    }
  }

  const complete = frames.length === 10 && !frames[9].pending;
  return {
    frames,
    complete,
    total: complete ? running : null,
    cumulative,
    next: complete ? null : nextState(throws),
    throwCount: throws.length,
  };
}

// 渲染十轮文本记分卡（CLI 用）。
export function renderCard(a: Analysis): string {
  const sym = (frame: FrameScore): string => {
    const t = frame.throws;
    if (frame.frame < 10) {
      if (frame.kind === 'strike') return ' X';
      if (t.length === 1) return ` ${t[0] === 0 ? '-' : t[0]}`;
      const s = t[0] === 0 ? '-' : String(t[0]);
      return `${s}${t[0] + t[1] === 10 ? '/' : t[1] === 0 ? '-' : t[1]}`;
    }
    let out = '';
    let standing = 10;
    for (const v of t) {
      if (v === 10 && standing === 10) out += 'X';
      else if (v === standing && v !== 0 && out.length > 0) out += '/';
      else out += v === 0 ? '-' : String(v);
      if (v === 10 || v === standing) standing = 10;
      else standing -= v;
    }
    return out;
  };

  const lines: string[] = [];
  const head: string[] = [];
  const body: string[] = [];
  const cum: string[] = [];
  for (let f = 1; f <= 10; f++) {
    const fr = a.frames[f - 1];
    head.push(` ${String(f).padEnd(6)}`);
    body.push(` ${(fr ? sym(fr) : '').padEnd(6)}`);
    const c = a.cumulative[f - 1];
    cum.push(` ${(fr ? (c === null ? '待定' : String(c)) : '').padEnd(6)}`);
  }
  lines.push('轮次 |' + head.join('|') + '|');
  lines.push('投球 |' + body.join('|') + '|');
  lines.push('累计 |' + cum.join('|') + '|');

  for (const fr of a.frames) {
    if (fr.bonusFrom.length > 0) {
      lines.push(
        `第 ${fr.frame} 轮（${fr.kind === 'strike' ? '全倒' : '补中'}）奖励引用投球编号: ${fr.bonusFrom.join(', ')}` +
          (fr.pending ? '（奖励球未齐，分数待定）' : '')
      );
    } else if (fr.pending) {
      lines.push(`第 ${fr.frame} 轮尚未完成，分数待定`);
    }
  }
  if (a.complete) lines.push(`局已结束，总分: ${a.total}`);
  else if (a.next) {
    lines.push(
      `下一球: 第 ${a.next.frame} 轮，剩余 ${a.next.standingPins} 瓶，可投上限 ${a.next.maxPins}` +
        (a.next.rackReset ? '（重新摆满）' : '')
    );
  }
  return lines.join('\n');
}
