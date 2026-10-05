# 十瓶保龄球逐球计分后端

TypeScript + Node.js + SQLite（`node:sqlite`，无原生依赖、无外部服务）实现的单人一局十瓶保龄球逐球计分服务，提供 HTTP API 与 CLI。仅处理规则与记录：不含联赛排名、让分、犯规判罚或传感器采集。

## 环境要求

- Windows 本地运行，Node.js ≥ 22（使用内置 `node:sqlite`），无需 Docker / WSL / 外部 API。

## 快速开始

```powershell
npm install        # 仅安装 typescript 与 @types/node
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm start          # 启动 API 服务（默认随机空闲端口，控制台打印实际端口）
npm run demo       # 运行内置演示场景
```

端口配置：`node dist/src/server.js --port 8080` 或环境变量 `PORT`；不传则为 0（操作系统分配空闲端口）。
数据目录：默认 `./data/bowling.db`，可用环境变量 `BOWLING_DATA_DIR` 改变。重启后未结束的局可继续录入，已结束的局保持最终总分并拒绝新投球。

## 规则范围

- 一局十轮。第 1–9 轮：全倒（strike）= 10 + 后两球；补中（spare）= 10 + 后一球；开放轮 = 两球之和。
- 同一后续球可同时作为多个前轮的奖励球，但在序列中只保存一次真实投球。
- 未全倒时第二球不得超过当前剩余瓶数。
- 第十轮：首球全倒可再投两球（第一补投全倒则再次摆满，否则第二补投只能打剩余瓶）；前两球补中再投一球并摆满；开放轮无补投。第十轮分数 = 本轮合法投球之和，不再产生奖励。
- 奖励球未齐时该轮分数为**待定**（`score: null`），绝不按零分处理；累计分只在之前各轮全部结算后给出，之前均为 `null`。
- 每次修改（追加/撤销/导入）都从完整投球序列重新核算，不覆写任何轮次分数；只支持撤销末尾一球，不支持任意插入。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/games` | 创建局，返回 `{game:{id,version,...}}` |
| POST | `/games/:id/throws` | 录入投球：`{"pins":7}` 单球或 `{"throws":[7,3]}` 批量，可带 `expectedVersion` |
| GET | `/games/:id` | 完整记分卡 JSON（各轮、奖励引用、待定、累计、下一球状态） |
| POST | `/games/:id/undo` | 撤销最后一球，可带 `expectedVersion` |
| GET | `/games/:id/export` | 导出 `{gameId,version,throws}` |
| POST | `/games/import` | `{"throws":[...]}` 导入序列创建新局 |
| GET | `/games/:id/events` | 状态转换事件日志（每次追加/撤销的依据） |

记分卡中每轮包含 `throwIndexes`（本轮投球的全局 1 起始编号）与 `bonusFrom`（奖励分引用的投球编号），`next` 字段给出下一球的轮次、剩余瓶数、可投上限与是否重新摆满（如第十轮 X、7 后 `maxPins=3`，X、X 后 `maxPins=10`）。

### 错误码

- `INVALID_PINS`（422）：瓶数不是 0..10 的整数
- `EXCEEDS_REMAINING`（422）：超过当前剩余瓶数
- `GAME_FINISHED`（422）：局已结束，拒绝额外投球
- `VERSION_CONFLICT`（409）：`expectedVersion` 与当前版本不一致
- `GAME_NOT_FOUND`（404）/ `BAD_REQUEST` / `BAD_JSON` / `NOTHING_TO_UNDO`

### 版本冲突处理

每次成功修改版本号 +1。客户端在追加/撤销时携带上次读到的 `expectedVersion`；若两个请求同时基于同一版本提交，后到者收到 `VERSION_CONFLICT`，需重新 GET 记分卡后重试，从而避免并发追加成错误顺序。批量录入在 SQLite 事务中原子写入，任一球不合法则整批回滚，不留下半批，版本号也不前进。

## CLI

```powershell
node dist/src/cli.js new                 # 创建局
node dist/src/cli.js roll 1 10 7 3       # 向局 1 录入三球
node dist/src/cli.js card 1              # 十轮文本记分卡
node dist/src/cli.js undo 1              # 撤销最后一球
node dist/src/cli.js export 1            # 导出投球序列 JSON
node dist/src/cli.js import 10 10 10     # 导入序列创建新局
node dist/src/cli.js events 1            # 查看状态转换日志
node dist/src/cli.js demo                # 演示场景
```

记分卡以文本表显示投球符号（`X` 全倒、`/` 补中、`-` 零瓶）、每轮累计分或「待定」，表后列出每个奖励分引用的投球编号与下一球的可投上限/摆瓶状态。

## 演示内容（`npm run demo`）

- 全零局总分 0；每轮 9、0 共 90 分；十二次全倒 300 分
- 连续三次全倒后的中间状态：第 1 轮已结算 30，第 2、3 轮奖励待定
- 第十轮 X、7 后非法补投 4 被拒绝（`EXCEEDS_REMAINING`），数据保持原状；合法补投 3 正常结算

## 观察未结算分数

- `GET /games/:id` 或 `cli.js card`：待定轮 `score` 为 `null`、累计为 `null`/`待定`，并说明缺哪几号奖励球。
- `GET /games/:id/events` 或 `cli.js events`：每次状态转换（create/append/undo）均有带版本号的记录，可追溯到具体投球。

## 测试

`npm test` 覆盖：普通轮、补中、连续全倒、零瓶、第十轮全部分支、额外投球拒绝、超剩余瓶拒绝、批量回滚、撤销后重投、重启继续、版本冲突、导入导出一致性，以及对完整序列的手算总分核对与前九轮奖励球编号核对。

## 已知限制

- 单进程服务，未做鉴权；面向本地单人使用。
- 仅支持撤销末尾投球，不支持任意位置插入/修改。
- 事件日志只增不删，长期大量使用需自行清理 `data/` 目录。
