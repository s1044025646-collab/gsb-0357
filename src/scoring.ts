// 十瓶保龄球逐球计分核心引擎（纯函数，无 IO）。
// 所有“球编号”均为从 1 开始的全局投球序号。

export type ErrorCode =
  | 'INVALID_PINS'
  | 'EXCEEDS_REMAINING'
  | 'GAME_OVER'
  | 'INVALID_SEQUENCE';

export class ScoringError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
}

export interface NextState {
  frame: number;
  ballInFrame: number;
  pinsStanding: number;
  maxPins: number;
  rackReset: boolean;
  done: boolean;
}

export interface FrameScore {
  index: number;
  rollNumbers: number[];
  pins: number[];
  symbol: string;
  base: number;
  bonusFrom: number[];
  bonusNeeded: number;
  bonus: number | null;
  total: number | null;
  pending: boolean;
  complete: boolean;
}

export interface Scorecard {
  frames: FrameScore[];
  cumulative: (number | null)[];
  totalScore: number | null;
  complete: boolean;
  rollCount: number;
  next: NextState;
}

function checkPins(pins: number): void {
  if (!Number.isInteger(pins) || pins < 0 || pins > 10) {
    throw new ScoringError('INVALID_PINS', `投球瓶数必须是 0..10 的整数，收到: ${pins}`);
  }
}

// 状态机：逐球推进并校验每一步合法性，返回投完这些球后的状态。
export function computeState(rolls: number[]): NextState {
  let frame = 1;
  let ball = 1;
  let standing = 10;
  let reset = true;
  let i = 0;

  const throwBall = (pins: number) => {
    checkPins(pins);
    if (pins > standing) {
      throw new ScoringError(
        'EXCEEDS_REMAINING',
        `第 ${i + 1} 球击倒 ${pins} 瓶，超过当前剩余瓶数 ${standing}`,
      );
    }
    standing -= pins;
    reset = false;
    i++;
  };

  while (i < rolls.length) {
    if (frame > 10) {
      throw new ScoringError('GAME_OVER', '本局已结束，拒绝额外投球');
    }
    if (frame < 10) {
      throwBall(rolls[i]);
      if (ball === 1 && rolls[i - 1] === 10) {
        frame++; ball = 1; standing = 10; reset = true;
      } else if (ball === 1) {
        ball = 2;
      } else {
        frame++; ball = 1; standing = 10; reset = true;
      }
    } else {
      throwBall(rolls[i]);
      if (ball === 1) {
        ball = 2;
        if (rolls[i - 1] === 10) { standing = 10; reset = true; }
      } else if (ball === 2) {
        const first = rolls[i - 2];
        const second = rolls[i - 1];
        if (second === 10 || first + second === 10) {
          ball = 3; standing = 10; reset = true;
        } else if (first === 10) {
          ball = 3; // 首球全倒但第二球未全倒：第三球只能打剩余瓶，不摆满
        } else {
          frame = 11;
        }
      } else {
        frame = 11;
      }
    }
  }

  const done = frame > 10;
  return {
    frame: Math.min(frame, 10),
    ballInFrame: ball,
    pinsStanding: standing,
    maxPins: done ? 0 : standing,
    rackReset: reset,
    done,
  };
}

export function validateRolls(rolls: number[]): void {
  computeState(rolls);
}

function frameSymbol(pins: number[], isTenth: boolean): string {
  if (!isTenth) {
    if (pins[0] === 10) return 'X';
    const parts = pins.map((p, idx) => {
      if (idx === 1 && pins[0] + p === 10) return '/';
      return p === 0 ? '-' : String(p);
    });
    return parts.join(' ');
  }
  const parts: string[] = [];
  let standing = 10;
  for (const p of pins) {
    if (p === 10 && standing === 10) parts.push('X');
    else if (standing < 10 && p === standing) parts.push('/');
    else parts.push(p === 0 ? '-' : String(p));
    standing = p === 10 || standing - p === 0 ? 10 : standing - p;
  }
  return parts.join(' ');
}

function tenthFrameComplete(pins: number[]): boolean {
  if (pins.length < 2) return false;
  const [a, b] = pins;
  if (a === 10 || a + b === 10) return pins.length === 3;
  return true;
}

// 由完整投球序列重新核算记分卡（不做任何覆写式修改）。
export function scorecard(rolls: number[]): Scorecard {
  validateRolls(rolls);
  const frames: FrameScore[] = [];
  let pos = 0;

  for (let f = 1; f <= 10; f++) {
    const isTenth = f === 10;
    const start = pos;
    const framePins: number[] = [];
    if (!isTenth) {
      if (pos < rolls.length) {
        framePins.push(rolls[pos++]);
        if (framePins[0] !== 10 && pos < rolls.length) framePins.push(rolls[pos++]);
      }
    } else {
      while (pos < rolls.length) framePins.push(rolls[pos++]);
    }
    const rollNumbers = framePins.map((_, k) => start + k + 1);
    const base = framePins.reduce((a, b) => a + b, 0);

    let bonusNeeded = 0;
    if (!isTenth) {
      if (framePins[0] === 10) bonusNeeded = 2;
      else if (framePins.length === 2 && framePins[0] + framePins[1] === 10) bonusNeeded = 1;
    }
    const bonusFrom: number[] = [];
    for (let k = 0; k < bonusNeeded; k++) bonusFrom.push(pos + k + 1);
    const bonusAvailable = bonusFrom.filter(n => n <= rolls.length);
    const bonus = bonusNeeded === 0
      ? 0
      : bonusAvailable.length === bonusNeeded
        ? bonusAvailable.reduce((a, n) => a + rolls[n - 1], 0)
        : null;

    const complete = isTenth
      ? tenthFrameComplete(framePins)
      : framePins.length > 0 && (framePins[0] === 10 || framePins.length === 2);

    const pending = complete && bonus === null;
    const total = complete && bonus !== null ? base + bonus : null;

    frames.push({
      index: f,
      rollNumbers,
      pins: framePins,
      symbol: frameSymbol(framePins, isTenth),
      base,
      bonusFrom,
      bonusNeeded,
      bonus,
      total,
      pending,
      complete,
    });
  }

  const cumulative: (number | null)[] = [];
  let running = 0;
  let allSettled = true;
  for (const fr of frames) {
    if (allSettled && fr.complete && fr.total !== null) {
      running += fr.total;
      cumulative.push(running);
    } else {
      allSettled = false;
      cumulative.push(null);
    }
  }
  const state = computeState(rolls);
  const totalScore = state.done && allSettled ? running : null;
  return {
    frames,
    cumulative,
    totalScore,
    complete: state.done,
    rollCount: rolls.length,
    next: state,
  };
}

// 校验一段完整序列是否为合法完整局，并返回总分（供测试/导入核对）。
export function finalScore(rolls: number[]): number {
  const card = scorecard(rolls);
  if (!card.complete || card.totalScore === null) {
    throw new ScoringError('INVALID_SEQUENCE', '投球序列不是一局完整合法的保龄球局');
  }
  return card.totalScore;
}
