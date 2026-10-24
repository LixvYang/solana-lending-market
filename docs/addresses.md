# devnet 地址清单

作者在 devnet 上的部署。全部是公开地址，不含任何密钥。浏览器查看:`https://explorer.solana.com/address/<地址>?cluster=devnet`。

## 需要 SOL 的钱包(运维)

| 钱包 | 地址 | 谁在用 | SOL 花在哪 | 余额(2026-10-24) | 建议 |
|---|---|---|---|---|---|
| 水龙头 / 兑换台 | `2UpAsC6XhKFzgmJZM71Wr1xb475a7JxvC34R3r6VQzNr` | `SERVICE=faucet` | 给新用户建代币账户的租金(最多 6 个，每人约 0.0123 SOL)、转账手续费;同时持有测试币库存 | 3.47 | 低于 1 SOL 补充;按默认限量(5 小时 30 份)最坏约 1.8 SOL/天 |
| 价格维护(keeper) | `CpJMdAiA55RgtkTNm4jLqQVgP4wGHiTMgcSjGD1ETYY1` | `SERVICE=keeper` | 每 180 秒写一次 mock 价格，实测约 237 笔/天 × 0.000015 SOL ≈ 0.0036 SOL/天 | 0.093(约 26 天) | 补到 0.5 SOL 可用约 140 天 |
| 管理员(部署者) | `6LzQJAR4A7KRcSHYhBhXdv4pcUuzAQtAfMMhoGDZ8NL9` | 只在本机跑管理脚本(建银行、改预言机、剧本) | 部署与配置交易 | 8.02 | **不部署到服务器** |

补充 SOL(从你自己的 devnet 钱包转):

```bash
solana transfer -u devnet <钱包地址> <数量> --allow-unfunded-recipient
solana balance -u devnet <钱包地址>
```

水龙头钱包里的测试币(tUSDC、tSOL 等)不足时，领取会返回"水龙头测试代币余额不足"。补充测试币需要管理员钱包(mint authority)或从其他持有者转入，见 `scripts/faucet-setup.ts`。

## 程序与借贷池

| 名称 | 地址 |
|---|---|
| marginfi 程序(mrgn-0.1.0,mock 价格补丁构建) | `8fQDybohNdR4rNcPFs6FYpHscMRLechbyBiCqjihdgv9` |
| mocks 程序(mock 价格账户的 owner) | `3UNhKQCzvj4ZXRP7BBy25STrRAh8VMtBiKmXimGUWAt7` |
| 借贷池(marginfi group) | `GHVn8kr8ffkk6qynGKKbZ8PAgCM8xGFR9Gnhen3xig35` |

## 资产

| 资产 | 代币 mint | 银行(bank) | 价格账户 | 价格来源 |
|---|---|---|---|---|
| tUSDC | `4CDNTDo9Us1YiB1a4mDUHAmKtpbNJwJsvDqk32V8xKg6` | `F99hSfDM9ymMiMshg38uKWRpXtmZ7rSKVX5F1aHkjWTb` | `7RMiw7Etg52juZmEvVuarM37TsWPpVc3bFfigNyxByis` | mock,keeper 定时写入 |
| tSOL | `2mjxAijRHGKd5U3imWCQAaKs31KKE2KtzjBdXbU6CacE` | `EkXhsMEg5D4xeBXH6pd4MQnTLiRukeKiS8k4XyWP5Kgq` | `3u7wgGo6hFmHVkZjScWTXEAwCdMCXgbUV59rtvPSnZhB` | mock,keeper 定时写入 |
| tHYPE | `F3nzz3p8L6maUBs8kmS4xi7Jzbiu9DP1z8aFXye1JKGs` | `H3eVeTmiHAP3jhd46ubVxVf58nMhQK4dJ2ScFFTtDRaE` | `35JES1e18iBY9Wm3T4LCjErHM3vSbvimsHQXxXnHoCot` | 固定 $80,keeper 定时写入(D-027) |
| pSOL | `bjwmjXvFypKzUwfFEp4ZraarSWsF79e72HbLftQ3z33` | `D77PE9gnPYQD16kwDFSHgXfReA8Ud133PF3bKVfPr4pN` | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | Pyth devnet 实时 |
| pBTC | `21cLYwWgvUyy8o274jYhMSKmtMQVGbkQoau6PaSCnHUK` | `96YbFnubhTuipauMm7K9yUuZbnVtiVaG2ywh8gNSqFgo` | `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` | Pyth devnet 实时 |
| pETH | `4fhoQPcwf7tLwbHT1kUqAzje4vhpVGcduxhoRwbBSZvs` | `8SrSgi5EXVme1ayntfXEfKKTnPzMRBroG6o26ue2KEw8` | `42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC` | Pyth devnet 实时 |

## 剧本角色(EP3)

由固定字符串确定性派生(`scenario/lib/actors.ts`),不落盘密钥。

| 角色 | 钱包 | marginfi 账户 |
|---|---|---|
| alice | `J8H3S29MjSzXvp1Jm4JhnPwJnqY4yCsfaMX3cTuvwJh3` | `2yDJ1WYiAf7kL1t4fSmTkx91wPJFSEhMkUZdWo526Pbb` |
| bob | `Abh88w383B3EhJYpSoxNV55qL5dG3czNGyQx7hcUPj9S` | `J3qhTbWkvqqu6jyjHQLmj9kkZ9GkYAxuFrDrSLrwx54r` |
| carol | `Dzv4jmLwyyo3B9S7jYgAyBWQtFsfQVYysAZTv9B4QPVb` | `J3VRUhRDd3Xo5ef8HtmdjFmKoQ4JQcEAjcuSLMRTwDYZ` |

SYNC: 新增资产、换钱包或重新部署时同步本表、`program/devnet.json` 与 `docs/deploy.md`。
