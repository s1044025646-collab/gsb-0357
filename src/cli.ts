// CLI：创建局、逐球/批量录入、记分卡、撤销、导入导出、演示。
import { Store, defaultDbPath } from './store';
import { renderCard } from './scoring';

const USAGE = [
  '用法: node dist/src/cli.js <命令> [参数]',
  '命令:',
  '  new                          创建新局，输出局 id',
  '  roll <gameId> <pins...>      录入一球或多球（逐球校验，整批原子写入）',
  '  card <gameId>                显示十轮记分卡（符号/奖励来源/待定/累计）',
  '  undo <gameId>                撤销最后一球',
  '  export <gameId>              导出投球序列 JSON',
  '  import <pins...>             以投球序列创建新局',
  '  events <gameId>              查看状态转换事件日志',
  '  demo                         运行内置演示场景',
  '环境变量: BOWLING_DATA_DIR 指定数据目录（默认 ./data）',
  '',
].join('\n');

function argNums(args: string[]): number[] {
  return args.map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n)) throw new Error(`参数不是整数: ${s}`);
    return n;
  });
}

function printCard(store: Store, id: number): void {
  const { game, analysis } = store.scorecard(id);
  console.log(`局 #${game.id}  版本 ${game.version}`);
  console.log(renderCard(analysis));
}

function demo(store: Store): void {
  const run = (title: string, pins: number[]): number => {
    const g = store.createGame();
    console.log(`\n=== ${title} (局 #${g.id}) ===`);
    try {
      store.appendThrows(g.id, pins);
    } catch (err) {
      console.log(`录入被拒绝: ${(err as Error).message}`);
    }
    printCard(store, g.id);
    return g.id;
  };

  run('全零，总分 0', Array(20).fill(0));
  run('每轮 9 再 0，总分 90', Array(20).fill(0).map((_, i) => (i % 2 === 0 ? 9 : 0)));
  run('十二次全倒，总分 300', Array(12).fill(10));
  run('连续三次全倒后的中间状态（奖励待定）', [10, 10, 10]);

  // 第十轮 X,7 后非法补投被拒绝，数据保持原状
  const pins = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 7];
  const id = run('第十轮 X,7（下一球上限 3）', pins);
  console.log('\n--- 尝试非法补投 4（超过剩余 3 瓶） ---');
  try {
    store.appendThrows(id, [4]);
    console.log('错误: 未被拒绝');
  } catch (err) {
    console.log(`已拒绝: ${(err as Error).message}`);
  }
  printCard(store, id);
  console.log('\n--- 合法补投 3 后 ---');
  store.appendThrows(id, [3]);
  printCard(store, id);
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  const store = new Store(defaultDbPath());
  try {
    switch (cmd) {
      case 'new': {
        const g = store.createGame();
        console.log(`已创建局 #${g.id}`);
        break;
      }
      case 'roll': {
        const [id, ...pins] = rest;
        const analysis = store.appendThrows(Number(id), argNums(pins));
        console.log(`已录入，当前投球数 ${analysis.throwCount}`);
        printCard(store, Number(id));
        break;
      }
      case 'card':
        printCard(store, Number(rest[0]));
        break;
      case 'undo': {
        store.undoLast(Number(rest[0]));
        console.log('已撤销最后一球');
        printCard(store, Number(rest[0]));
        break;
      }
      case 'export': {
        const { game, throws } = store.scorecard(Number(rest[0]));
        console.log(JSON.stringify({ gameId: game.id, version: game.version, throws }));
        break;
      }
      case 'import': {
        const { game } = store.importThrows(argNums(rest));
        console.log(`已导入为局 #${game.id}`);
        printCard(store, game.id);
        break;
      }
      case 'events':
        console.log(JSON.stringify(store.getEvents(Number(rest[0])), null, 2));
        break;
      case 'demo':
        demo(store);
        break;
      default:
        process.stdout.write(USAGE);
        if (cmd) process.exitCode = 1;
    }
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.error(`错误${e.code ? ` [${e.code}]` : ''}: ${e.message}`);
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

main();
