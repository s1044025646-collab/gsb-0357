// CLI：直接操作本地 SQLite 存储，输出十轮文本记分表。
import { Store } from './store';
import { Scorecard } from './scoring';

export function renderCard(card: Scorecard): string {
  const frames = card.frames;
  const cell = (s: string, w: number) => s.padEnd(w, ' ');
  const top = frames.map(f => cell(f.symbol || '·', f.index === 10 ? 7 : 5)).join('|');
  const bonusLine = frames.map(f => {
    let s = '';
    if (f.bonusNeeded > 0) {
      s = f.pending ? `奖?←${f.bonusFrom.join(',')}` : `奖+${f.bonus}←${f.bonusFrom.join(',')}`;
    }
    return cell(s, f.index === 10 ? 7 : 5);
  }).join('|');
  const cumLine = frames.map((f, i) => {
    const c = card.cumulative[i];
    return cell(c === null ? (f.complete ? '待定' : '') : String(c), f.index === 10 ? 7 : 5);
  }).join('|');

  const lines = [
    `轮次  | ${frames.map(f => cell(String(f.index), f.index === 10 ? 7 : 5)).join('|')}`,
    `投球  | ${top}`,
    `奖励  | ${bonusLine}`,
    `累计  | ${cumLine}`,
  ];
  const n = card.next;
  const state = n.done
    ? `本局已结束，总分 ${card.totalScore}`
    : `第 ${n.frame} 轮第 ${n.ballInFrame} 球，剩余 ${n.pinsStanding} 瓶，可投 0..${n.maxPins}` +
      `${n.rackReset ? '（刚摆满新瓶）' : ''}`;
  lines.push(`状态  | ${state}`);
  lines.push(`总分  | ${card.totalScore === null ? '待定（存在未结算奖励）' : card.totalScore}`);
  return lines.join('\n');
}

function printUsage(): void {
  console.log(`用法:
  node dist/src/cli.js create                      创建一局，输出 gameId
  node dist/src/cli.js roll <gameId> <pins...>     录入一球或多球
  node dist/src/cli.js score <gameId>              显示完整记分卡
  node dist/src/cli.js undo <gameId>               撤销最后一球
  node dist/src/cli.js export <gameId>             导出投球序列 JSON
  node dist/src/cli.js import <pins...>            以投球序列创建新局
环境变量 BOWLING_DATA_DIR 指定数据目录（默认 ./data）。`);
}

export function runCli(argv: string[], store: Store): void {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'create': {
      const g = store.createGame();
      console.log(`已创建局 ${g.id}（version=${g.version}）`);
      break;
    }
    case 'roll': {
      const [id, ...pinsArgs] = rest;
      const pins = pinsArgs.map(Number);
      if (pins.some(p => !Number.isInteger(p))) throw new Error('投球必须是整数');
      const card = store.appendRolls(Number(id), pins);
      console.log(renderCard(card));
      break;
    }
    case 'score': {
      console.log(renderCard(store.scorecard(Number(rest[0]))));
      break;
    }
    case 'undo': {
      console.log(renderCard(store.undoLast(Number(rest[0]))));
      break;
    }
    case 'export': {
      const id = Number(rest[0]);
      console.log(JSON.stringify({ gameId: id, version: store.version(id), rolls: store.getRolls(id) }));
      break;
    }
    case 'import': {
      const rolls = rest.map(Number);
      const { game, card } = store.importGame(rolls);
      console.log(`已导入为局 ${game.id}`);
      console.log(renderCard(card));
      break;
    }
    default:
      printUsage();
  }
}

if (require.main === module) {
  const store = new Store();
  try {
    runCli(process.argv.slice(2), store);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    console.error(`错误 [${err.code ?? 'ERROR'}] ${err.message}`);
    process.exitCode = 1;
  } finally {
    store.close();
  }
}
