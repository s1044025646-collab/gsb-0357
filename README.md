# 十瓶保龄球逐球计分后端

TypeScript + Node.js + SQLite（`node:sqlite`，零原生依赖）实现的单人单局十瓶保龄球逐球计分服务，提供 HTTP API 与 CLI。仅本机运行，不依赖 Docker / WSL / 外部服务。

## 规则范围

- 标准一局十轮；输入每次投球击倒的瓶数（0..10 的整数）。
- 前九轮：全倒 = 10 + 后两球；补中 = 10 + 后一球；开放轮 = 两球之和。
- 同一后续球可同时参与多个前轮的奖励计算，但只作为一次真实投球保存。
- 未全倒时第二球不得超过当前剩余瓶数。
- 第十轮：首球全倒可再投两球（第一补投全倒则再次摆满，否则第二补投只能打剩余瓶）；前两球补中只补一球并摆满；开放轮无补投。第十轮分数即本轮合法投球之和，不再产生奖励。
- 已结束的局拒绝额外投球（`GAME_OVER`）。
- **不做**联赛排名、让分、犯规判罚、传感器采集；只支持末尾撤销，不支持任意插入。

## 待定（未结算）分数

奖励所需的后续球尚未投出时，该轮 `total` 为 `null`、`pending: true`，绝不当 0 计。`cumulative` 仅在其之前各轮全部确定时给出，否则为 `null`；存在未结算轮时 `totalScore` 为 `null`。每轮的 `bonusFrom` 列出奖励分引用的全局球编号（从 1 开始），可据此审计每一分来自哪些投球。

## 构建 / 测试 / 启动 / 演示

```powershell
npm install
npm run build    # 编译到 dist/
npm test         # 构建并运行全部测试（node:test）
npm start        # 启动 API（默认绑定 127.0.0.1 的空闲端口；PORT=8080 可指定）
npm run demo     # 演示：0 分局 / 90 分局 / 300 满分 / 连续全倒待定态 / 非法补投拒绝
```

要求 Node.js ≥ 22.5（使用内置 `node:sqlite`，目前为实验特性，会有 ExperimentalWarning，不影响功能）。

## CLI

```powershell
npm run cli                      # 显示用法
node dist/src/cli.js create
node dist/src/cli.js roll 1 10 7 3     # 局 1 录入三球
node dist/src/cli.js score 1           # 十轮文本表：符号 / 奖励来源 / 待定 / 累计
node dist/src/cli.js undo 1
node dist/src/cli.js export 1
node dist/src/cli.js import 10 10 10 10 10 10 10 10 10 10 10 10
```

文本表含义：`奖+20←2,3` 表示本轮奖励 20 分、引用第 2、3 球；`奖?←3,4` 表示奖励待定（球 4 未投）；累计列的 `待定` 表示之前存在未结算轮。

## HTTP API

默认端口为系统分配的空闲端口（启动日志打印实际端口），`PORT` 环境变量可指定。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/games` | 创建一局 → `{ gameId, version }` |
| POST | `/games/:id/rolls` | 录入 `{ "pins": 7 }` 或 `{ "pins": [7,2,10] }`，可选 `"version": n` 乐观锁 |
| GET | `/games/:id` | 完整记分卡（含每轮奖励来源球编号、待定状态、累计分、下一球上限与摆瓶状态） |
| POST | `/games/:id/undo` | 撤销最后一球 |
| GET | `/games/:id/export` | 导出投球序列 |
| POST | `/games/import` | `{ "rolls": [...] }` 导入为新局 |

错误响应统一为 `{ "error": { "code", "message" } }`：

- `INVALID_PINS`（422）：瓶数不是 0..10 的整数
- `EXCEEDS_REMAINING`（422）：超过当前剩余瓶数（含第十轮补投）
- `GAME_OVER`（422）：局已结束仍投球
- `VERSION_CONFLICT`（409）：版本冲突
- `NOT_FOUND`（404）、`BAD_REQUEST`（400）、`EMPTY_GAME`（422）

## 并发与持久化

- 每局一个单调递增 `version`；追加投球时携带 `version` 即启用乐观锁（`UPDATE ... WHERE version = ?`），两个请求同时追加时后提交者收到 `VERSION_CONFLICT`，不会交错成错误顺序。不传 `version` 则只做原子追加。
- 批量录入先整体校验再写入，且整个批次在单个事务（`BEGIN IMMEDIATE`）中提交：失败批量输入不会留下半批。
- 投球逐条追加保存（`rolls` 表），分数不落库、每次从序列重新核算；局结束时把最终总分写入 `games.final_score` 快照。重启后未结束的局可继续录入，已结束的局保持最终总分。
- 数据目录默认为项目内 `./data`，可用 `BOWLING_DATA_DIR` 覆盖；演示数据在 `./data/demo/`。

## 项目结构

- `src/scoring.ts`：纯函数计分引擎（状态机校验 + 记分卡核算）
- `src/store.ts`：SQLite 持久化、事务、版本乐观锁
- `src/server.ts`：HTTP API（`node:http`，无框架）
- `src/cli.ts`：CLI 与十轮文本表渲染
- `src/demo.ts`：演示脚本
- `test/`：计分规则、持久化、API 三层测试（23 个用例）

## 已知限制

- `node:sqlite` 在 Node 25 仍标记为实验特性（API 可能变化）。
- CLI 直接读写同一 SQLite 文件，不经过 HTTP 服务；与 API 同时使用时依赖 SQLite 自身锁与版本号。
- 仅末尾撤销；修改历史通过从序列重新核算生效，不覆写某轮总分。
