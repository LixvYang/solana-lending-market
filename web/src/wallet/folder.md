# Wallet UI

## Overview
钱包连接、交易构建与发送，以及测试币领取的前端流程。

## Files

| File | Role | Function |
|------|------|----------|
| ActionForm.tsx | Component | 构建、模拟并签名发送存借交易。 |
| GetTokens.tsx | Component | 请求测试币水龙头并展示领取结果。 |
| Providers.tsx | Provider | 配置钱包适配器、连接与测试钱包。 |
| WalletButton.tsx | Component | 提供中文钱包操作文案和固定图标。 |
| WalletPanel.tsx | Component | 展示钱包引导、头寸和可操作资产。 |
| chain.ts | Client | 调用钱包、交易构建、发送及水龙头接口。 |
| test-wallet.ts | Adapter | 开发模式的本地测试钱包适配器。 |

---
SYNC ALERT: If this folder changes (files added/removed/renamed), UPDATE THIS FILE.
