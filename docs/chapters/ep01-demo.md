# EP1 成品演示:借贷市场

## 本集要回答的问题

一笔链上的借款交易,最后怎么变成数据库里的一行、网页上的一个数字?

## 你会看到什么

打开一个页面,上面是一个真实部署在 Solana devnet 上的借贷池(marginfi mrgn-0.1.0)。页面分五个 tab:

- **借贷池**:市场列表——每个资产(pSOL、tSOL、tUSDC)的价格与来源、存款与借款、存借 APR、利用率、最高抵押率;选中一个资产看它的利率曲线、参数和说明。
- **我来操作**:连接 devnet 钱包,对池子存款、借款、还款、取款。交易由服务端构建并先模拟,钱包只负责签名;首次存款会自动创建 marginfi 账户。
- **兑换**:SOL 与测试币任意互换,按借贷池用的同一个价格成交;没有测试币可以先从水龙头领。
- **账户**:谁快被清算了。健康度的算法和程序自己算的结果能对上到小数点后六位。
- **链上活动** 与 **交易详情**:每一笔存款、借款、还款、清算;点任意一笔,并排看到它的三种形态——链上的原始字节、解码后的字段、写进数据库的那一行。

代币都有图标和说明,写进了链上元数据,钱包里也能看到。

后面几集,就是把这个页面从下往上一层层拆开(钱包交互、兑换、Pyth 价格、图标在 EP8 及其后续增补里)。

## 整体结构

```
 Solana devnet 上的 marginfi 程序
        │  getBlock / getSignaturesForAddress / getTransaction / getMultipleAccounts
        ▼
 ┌───────────────┐   ① 先存原始: raw_tx(唯一事实来源)
 │    ingest     │   ② 游标与原始数据同事务提交 → 幂等、崩溃可恢复
 └───────┬───────┘
         ▼
 ┌───────────────┐   指令: 手写 Borsh 解码(EP4)
 │    decode     │   事件 + 账户状态: 手写 zero_copy 解码(EP5)
 └───────┬───────┘   纯函数,可以对 raw_tx 重放 → 清库重跑结果一致(EP6)
         ▼
     PostgreSQL ──► API ──► 借贷市场前端(含交易详情)(EP7)
                     ▲
     浏览器钱包 ──签名──┘  构建交易 → 模拟 → 签名 → 转发(EP8)
```

三条贯穿全程的设计原则:

1. **先存原始,再解码。** 解码器写错了,改了重放就行,不用重新拉链上数据。
2. **幂等。** 同一批数据入库两次、中途崩溃后重跑,结果和一次跑完完全一样。
3. **池子指标以账户状态为准,事件只做活动流。** EP5 会用真实数据证明为什么。

## 先说清楚一件事:价格从哪来

借贷需要价格。页面上两种价格并存,每个价格旁边都标着来源:

- **tSOL / tUSDC 是"布局一致的 mock"。** 剧本要能把价格打低来演示清算,真实行情做不到;而且 Switchboard 已于 2026-09 整体关停(D-018)。所以价格由我们写入一个账户,字节布局与真实的 Switchboard 价格账户完全一致,marginfi 走的仍是读取 Switchboard 价格的那条代码路径。详见 EP3。
- **pSOL 是真实行情。** 价格来自 Pyth 在 devnet 上持续更新的 SOL/USD(D-019,EP8 后续增补)。

**除了价格来源,其余全部是真实的链上程序行为**:真实的 marginfi 程序、真实的交易、真实的清算。

## 自己跑一遍

需要 Node 24、pnpm。按想走多深,分三档:

**1. 只看解码(不需要网络、数据库、钱包)。** `fixtures/` 里有一次真实运行的原始数据,所有解码器测试都离线跑:

```bash
pnpm install
pnpm typecheck && pnpm test
```

**2. 接入作者在 devnet 上的部署(只需要一个 RPC 地址,另需 Docker)。** 不用构建、部署,也不用钱包:

```bash
cp .env.example .env            # 只填 RPC_URL(例如 Helius 免费的 devnet 地址)
docker compose up -d            # Postgres,端口 5433
pnpm exec tsx scripts/migrate.ts
pnpm exec tsx scripts/ingest.ts --backfill
pnpm exec tsx scripts/load-labels.ts
pnpm exec tsx scripts/serve-api.ts &
(cd web && pnpm install && pnpm dev)   # 打开 http://localhost:5173
```

程序和池子的公开地址在 `program/devnet.json`。

**3. 自己构建、部署、跑剧本(EP3)。** 还需要 Solana CLI 2.1.20 和一个有 devnet SOL 的钱包(`.env` 里填 `ANCHOR_WALLET`):

```bash
./program/build.sh
pnpm scenario                   # 只打印计划;加 --execute 才会真的发交易
```

然后同第 2 档入库。钱包交互(存借、兑换)还需要水龙头/兑换台的专用钱包,见 EP8。

## 合集路线

| 集 | 主题 | 一句话 |
|---|---|---|
| EP1 | 成品演示 | 本集 |
| EP2 | Solana 数据地图 | 链上到底有哪些数据,各从哪里取 |
| EP3 | 看懂借贷协议,造出链上数据 | 数据模型与可重复的剧本 |
| EP4 | 解析指令 | 一笔交易 → "谁调用了什么" |
| EP5 | 解析事件与账户状态 | "发生了什么" vs "现在是什么" |
| EP6 | 存储设计 | 幂等、可回填、可重放 |
| EP7 | 前端与总结 | 把一切摆在眼前 |
| EP8(可选) | 钱包交互 | 让别人也能往池子里发交易;兑换台、真实价格(后续增补) |

只想了解皮毛的话,看 EP1 和 EP2 就够了,配套有一页速查图 [cheatsheet.md](../cheatsheet.md)。

## 下一集

EP2:先把 Solana 链上的数据地图画清楚——后面每一步解析的都是这张地图上的某一块。
