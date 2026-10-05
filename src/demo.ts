// 演示脚本：覆盖满分、全零、九十分、连续全倒中间待定态、非法补投拒绝。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Store, StoreError, dataDir } from './store';
import { renderCard } from './cli';

function section(title: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

function main(): void {
  // 演示使用独立数据库文件，避免污染正式数据。
  const dir = path.join(dataDir(), 'demo');
  fs.rmSync(dir, { recursive: true, force: true });
  const store = new Store(path.join(dir, 'demo.db'));

  section('演示 1：全零局，总分 0');
  let g = store.createGame();
  let card = store.appendRolls(g.id, Array(20).fill(0));
  console.log(renderCard(card));

  section('演示 2：每轮 9 瓶再 0 瓶，总分 90');
  g = store.createGame();
  card = store.appendRolls(g.id, Array(10).fill([9, 0]).flat());
  console.log(renderCard(card));

  section('演示 3：十二次全倒，总分 300');
  g = store.createGame();
  card = store.appendRolls(g.id, Array(12).fill(10));
  console.log(renderCard(card));

  section('演示 4：连续全倒后奖励未确定的中间状态（只投了三球 X X X）');
  g = store.createGame();
  card = store.appendRolls(g.id, [10, 10, 10]);
  console.log(renderCard(card));
  console.log('说明：第 1 轮奖励引用球 2、3（已确定），第 2 轮奖励引用球 3、4（球 4 未投，待定）。');

  section('演示 5：第十轮 X、7 之后，非法补投 4 被拒绝，数据保持原状');
  g = store.createGame();
  store.appendRolls(g.id, [...Array(9).fill(0).flatMap(() => [0, 0] as number[]), 10, 7]);
  card = store.scorecard(g.id);
  console.log('投球前状态：第十轮 X、7，下一球上限应为 3');
  console.log(renderCard(card));
  try {
    store.appendRolls(g.id, [4]);
    console.log('错误：非法投球未被拒绝！');
  } catch (e) {
    const err = e as StoreError;
    console.log(`已拒绝非法补投: [${err.code}] ${err.message}`);
  }
  console.log('拒绝后记分卡（应与之前一致）:');
  console.log(renderCard(store.scorecard(g.id)));

  section('演示 6：第十轮 X、X 之后下一球上限为 10');
  g = store.createGame();
  store.appendRolls(g.id, [...Array(9).fill(0).flatMap(() => [0, 0] as number[]), 10, 10]);
  console.log(renderCard(store.scorecard(g.id)));

  store.close();
}

main();
