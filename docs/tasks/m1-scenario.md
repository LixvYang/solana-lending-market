# 任务 M1:确定性剧本模块(scenario/)

交给 codex 实现。先读 `AGENTS.md`、`docs/00-goals.md`、`docs/decisions.md`(尤其 D-002、D-003、D-007)。

## 目标

写一个 TypeScript 剧本,在 **devnet** 上对自己部署的 marginfi(mrgn-0.1.0,`devnet` feature 构建)造出一段完整借贷行为,价格来自**自建的 Switchboard On-Demand feed**。剧本既是 EP3 的演示内容,也是后面解码器的数据来源,所以必须**步骤固定、可读、可重放、每笔交易都被记录**。

## 环境约束

- 依赖已在 `package.json` 里装好并锁定,**不要改版本,不要联网安装新依赖**。需要新依赖时在报告里写明,不要自己加。
- 沙箱里没有网络和钱包:你只能写代码、跑 `pnpm typecheck` 和 `pnpm test`(纯离线测试)。**不要尝试发送任何链上交易。**
- 输入文件(已由作者生成):
  - `program/out/program-ids.json`:`{mode, marginfi, mocks}`
  - `program/out/marginfi.idl.json`:marginfi 的 Anchor IDL(0.30 格式)
  - 上游源码在 `program/.upstream/`(只读参考,里面 `tests/` 有创建 group / bank 的配置示例)
- 运行时环境变量(写进 `.env.example`,不要提交 `.env`):`RPC_URL`(Helius devnet)、`ANCHOR_WALLET`(部署者密钥文件路径)。

## 参考实现(Switchboard 部分必须照着做)

`/Users/lixin/code/github/rebetxin/usdx-solana/scripts/src/switchboard-feeds.ts`、`switchboard.ts`,以及 `docs/ops/switchboard-devnet.md`。这些是已在 devnet 跑通的做法,**不要重新发明**,但要重写成本项目风格(短、直白、中文注释讲原因)。已知要点:

1. 任务定义用 `valueTask` 钉死一个常数价格。存到 Crossbar **必须走 v1**:`LegacyCrossbarClient.store(queue, jobs)`(来自 `@switchboard-xyz/common-legacy`),用 `/v2/store` 存的 crank 会 400。
2. feed 账户:`PullFeed.generate` + `initIx({ queue, feedHash, maxVariance, minResponses: 1, minSampleSize: 1, maxStaleness })`。传 `feedHash`,不要传 `jobs`。
3. crank:`fetchUpdateIx` 返回数组,第一个元素是指令数组;`numSignatures` 只用 1;ComputeBudget 指令必须放在交易**最后**。
4. **改价**:同一个 feed 账户用 `setConfigsIx({ feedHash })` 指向新价格对应的 feedHash(参考 `repointFeedHash`)。流程是:存新 valueTask → 重新指向 → crank。marginfi 的 Bank 里记录的是 feed 账户地址,所以改价**不需要**重配 Bank。此流程在参考项目里只用于修错哈希,没有拿来改过价,**请在代码注释里标注"改价路径尚未在链上验证"**,由作者实测。
5. SDK 自带较新的 web3.js,边界处只传地址和字节,不要让两份 web3.js 的对象穿过。
6. marginfi 对 `SwitchboardPull` 要求账户 owner 是 devnet 的 On-Demand 程序 `Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2`,价格有效期由 Bank 配置的 `oracle_max_age` 决定(为 0 时用默认值,请查源码确认)。因此每笔会读价格的交易**之前**要先 crank 一次;crank 与业务交易分成两笔、紧挨着发,比硬塞进一笔更简单(marginfi 的 borrow / liquidate 账户很多,容易超过 1232 字节)。

## 剧本步骤(固定顺序)

账户全部**确定性派生**:`sha256("solana-lending-indexer/" + 标签)` 作为 ed25519 种子,不落盘密钥。种子中的旧项目名是历史标识,改动会改变所有派生地址,不能修改。标签:`alice`(出借人)、`bob`(借款人)、`carol`(清算人);两个代币 mint 和 group 也同样派生。部署者钱包(`ANCHOR_WALLET`)是 admin,并用它给三个账户转 SOL。

| # | 步骤 | 说明 |
|---|---|---|
| 0 | 打印计划(默认只打印,`--execute` 才发交易) | 估算花费 SOL |
| 1 | 创建 mint:`tUSDC`(6 位)、`tSOL`(9 位),给 alice/bob/carol 铸币 | |
| 2 | 创建/更新两个 Switchboard feed:tUSDC=1,tSOL=100;crank | |
| 3 | `marginfi_group_initialize` | group 地址由种子派生 |
| 4 | 添加两个 bank,oracle_setup 为 `SwitchboardPull`,oracle key 为对应 feed | 权重和利率配置参考上游 `tests/`;**选一组权重,使 tSOL 抵押 $100 时 bob 借 5000 tUSDC 健康,价格降到 $50 时低于维持线** |
| 5 | 三人各 `marginfi_account_initialize` | |
| 6 | alice 存入 10,000 tUSDC | |
| 7 | bob 存入 100 tSOL | |
| 8 | bob 借出 5,000 tUSDC(crank 后) | |
| 9 | `lending_pool_accrue_bank_interest`(两个 bank) | |
| 10 | tSOL 改价到 $50,crank | |
| 11 | carol 存入 tUSDC 作为清算资本,然后清算 bob | |
| 12 | 视状态:alice 取出部分 tUSDC;bob 若仍有负债则还款 | 要覆盖 deposit / withdraw / borrow / repay / liquidate 五类指令各至少一次 |

## 产出

每次 `--execute` 运行写 `scenario/out/run-<时间戳>.json`(gitignore):

```json
{ "steps": [{ "step": 8, "label": "bob borrow", "signatures": ["..."], "slot": 0 }],
  "addresses": { "group": "", "banks": {}, "feeds": {}, "mints": {}, "marginfiAccounts": {} },
  "events": [{ "signature": "", "name": "LendingAccountBorrowEvent", "data": {} }] }
```

`events` 用 **Anchor 的 `EventParser`** 从交易日志解出(这是后面自写解码器的对照基准,必须独立于我们的解码器)。

另写 `scenario/expected.ts`:根据 `events` 累加得出每个账户每个 bank 的净存款/净借款(数量,不是 shares),输出 `scenario/out/expected-<时间戳>.json`。

## 代码要求

- 目录:`scenario/run.ts`(入口,解析 `--execute`)、`scenario/steps/NN-*.ts`(一步一个文件,导出同样签名的函数)、`scenario/lib/`(`actors.ts` 派生账户、`rpc.ts`、`switchboard.ts`、`marginfi.ts` 构造指令、`record.ts` 记录)。
- 单文件尽量不超过约 150 行;注释讲原因(尤其是 Switchboard 的坑),不讲"这行做什么"。
- 不做抽象层、不做依赖注入;失败时抛明确错误。
- 教学片段用 `// #region ep3-xxx` / `// #endregion` 标记(至少:确定性派生账户、创建 feed、crank、改价、添加 bank)。
- 离线测试(`node:test`,`*.test.ts` 放在对应文件旁):账户派生稳定且固定(写死期望公钥)、计划打印、`expected` 累加逻辑(用手写的事件样本)。
- `pnpm typecheck` 与 `pnpm test` 必须通过。
- 先读 `program/.upstream/tests/` 和 IDL 再写指令参数,不要凭记忆。拿不准的 marginfi 账户顺序/参数,以 IDL 为准,并在注释写"来源:IDL / 上游文件路径"。
- 最后在 `docs/progress.md` 的 M1 一行更新状态为 `doing` 并写明哪些**没有被运行过**。

## 验收(由作者在 devnet 实测)

- `--execute` 一次跑完,步骤 12 之后 bob 的健康度回到正常或负债清零。
- `events` 中出现 deposit / borrow / repay / withdraw / liquidate 五类事件。
- 同一份剧本重跑(新 group)结果结构一致。
