/**
 * 仅开发预览用：没有 API 时 `?mock` 会接管 fetch，返回符合 src/api/types.ts 契约的假数据。
 * 数值取自真实剧本的结束状态；`?mock=liquidation` 改成"清算前一刻的 Bob"，用来看可清算状态的样子。
 * 不属于产品代码，生产构建不会引入它(只在 import.meta.env.DEV 下动态加载)。
 */
import type { AccountView, ActivityItem, BankHistoryView, BankView, LiquidationItem, PoolView, RateCurveView, RatePoint, WalletHistoryItem } from '@contract';
import run from '../../fixtures/m1-run.json';
import xray from './mock-xray.json';
import devnet from '../../program/devnet.json';
import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { b64 } from './wallet/chain';
import { toNative } from './format';

const a = run.addresses;
const curve = { optimal_utilization: 0.5, plateau_rate: 0.6, max_rate: 3, fee_rate: 0.06, fee_fixed_apr: 0.04 };
const rates = (u: number): RatePoint => {
  const base = u <= curve.optimal_utilization ? (u / curve.optimal_utilization) * curve.plateau_rate
    : ((u - curve.optimal_utilization) / (1 - curve.optimal_utilization)) * (curve.max_rate - curve.plateau_rate) + curve.plateau_rate;
  return { utilization: u, lending_apr: base * u, borrowing_apr: base * (1 + curve.fee_rate) + curve.fee_fixed_apr };
};

export function installMock() {
  const liquidation = new URLSearchParams(location.search).get('mock') === 'liquidation';
  const bank = (address: string, label: string, mint: string, decimals: number, price: number, dep: string, bor: string, depUsd: number, borUsd: number): BankView => {
    const u = depUsd ? borUsd / depUsd : 0;
    return { address, mint, label, decimals, price, price_updated_at: new Date().toISOString(), oracle_feed: null, oracle_source: 'mock', total_deposits: dep, total_borrows: bor,
      total_deposits_usd: depUsd, total_borrows_usd: borUsd, utilization: u, lending_apr: rates(u).lending_apr, borrowing_apr: rates(u).borrowing_apr,
      weights: label !== 'tUSDC' ? { asset_init: 0.8, asset_maint: 0.9, liability_init: 1.1, liability_maint: 1.05 } : { asset_init: 1, asset_maint: 1, liability_init: 1.1, liability_maint: 1.05 },
      curve, asset_share_value: '1.000000155398776513', liability_share_value: '1.000000445109712643', last_accrual_at: new Date().toISOString() };
  };
  const banks = [
    bank(a.banks.tUSDC, 'tUSDC', a.mints.tUSDC, 6, 1, liquidation ? '16000000000' : '14512501895', liquidation ? '5000001696' : '0', liquidation ? 16000 : 14512.5, liquidation ? 5000 : 0),
    bank(a.banks.tSOL, 'tSOL', a.mints.tSOL, 9, 50, '100000000000', '0', 5000, 0),
    // Pyth 定价的银行(地址取自 program/devnet.json,价格是 2026-10-22 的近似值);有少量借款，利用率才不是一片 0。
    ...([['pSOL', devnet.labels.banks.pSOL, devnet.labels.mints.pSOL, 9, 108, '120000000000', '15000000000'],
      ['pBTC', devnet.labels.banks.pBTC, devnet.labels.mints.pBTC, 8, 84400, '6000000', '1500000'],
      ['pETH', devnet.labels.banks.pETH, devnet.labels.mints.pETH, 8, 2500, '400000000', '120000000'],
      ['tHYPE', devnet.labels.banks.tHYPE, devnet.labels.mints.tHYPE, 8, 80, '90000000000', '40000000000']] as const).map(([label, address, mint, decimals, price, dep, bor]) => {
      const usd = (n: string) => Number(n) / 10 ** decimals * price;
      return { ...bank(address, label, mint, decimals, price, dep, bor, usd(dep), usd(bor)), oracle_source: label === 'tHYPE' ? 'mock' as const : 'pyth' as const };
    }),
  ];
  const sum = (f: 'total_deposits_usd' | 'total_borrows_usd') => banks.reduce((s, b) => s + (b[f] ?? 0), 0);
  const pool: PoolView = { program: '8fQDybohNdR4rNcPFs6FYpHscMRLechbyBiCqjihdgv9', group: a.group, as_of_slot: '509953400', banks,
    totals: { deposits_usd: sum('total_deposits_usd'), borrows_usd: sum('total_borrows_usd'), utilization: sum('total_borrows_usd') / sum('total_deposits_usd') } };
  const balance = (b: BankView, deposit: string, borrow: string, du: number, bu: number) => ({ bank: b.address, label: b.label, deposit, borrow, deposit_usd: du, borrow_usd: bu });
  const accounts: AccountView[] = [
    { address: a.marginfiAccounts.alice, label: 'alice', authority: a.actors.alice, balances: [balance(banks[0], '9000001546', '0', 9000, 0)],
      health: { init: 9000, maint: 9000, assets_usd: 9000, liabilities_usd: 0 }, status: 'no_debt' },
    liquidation
      ? { address: a.marginfiAccounts.bob, label: 'bob', authority: a.actors.bob, balances: [balance(banks[1], '100000000000', '0', 5000, 0), balance(banks[0], '0', '5000001696', 0, 5000)],
          health: { init: -1000.0, maint: -750.0018, assets_usd: 4500, liabilities_usd: 5250.0018 }, status: 'liquidatable' }
      : { address: a.marginfiAccounts.bob, label: 'bob', authority: a.actors.bob, balances: [balance(banks[1], '90000000000', '0', 4500, 0)],
          health: { init: 3600, maint: 4050, assets_usd: 4050, liabilities_usd: 0 }, status: 'no_debt' },
    { address: a.marginfiAccounts.carol, label: 'carol', authority: a.actors.carol, balances: [balance(banks[0], '5512500348', '0', 5512.5, 0), balance(banks[1], '10000000000', '0', 500, 0)],
      health: { init: 5912.5, maint: 5962.5, assets_usd: 5962.5, liabilities_usd: 0 }, status: 'no_debt' },
  ];
  const nameOf = (l: string) => l.startsWith('bob borrow') ? 'lending_account_borrow' : l.includes('deposit') ? 'lending_account_deposit' : l.includes('liquidate') ? 'lending_account_liquidate'
    : l.includes('withdraw') ? 'lending_account_withdraw' : l.includes('repay') ? 'lending_account_repay' : l.startsWith('accrue') ? 'lending_pool_accrue_bank_interest'
    : l.startsWith('add bank') ? 'lending_pool_add_bank' : l.startsWith('create marginfi') ? 'marginfi_account_initialize' : l === 'create group' ? 'marginfi_group_initialize' : null;
  const items: ActivityItem[] = run.steps.filter((s) => nameOf(s.label)).reverse().map((s) => {
    const tok = s.label.includes('tSOL') ? 'tSOL' : s.label.includes('tUSDC') ? 'tUSDC' : null;
    const who = ['alice', 'bob', 'carol'].find((p) => s.label.includes(p)) ?? null;
    const amt = /(\d[\d,]*) (tUSDC|tSOL)/.exec(s.label);
    return { signature: s.signatures[0], slot: String(s.slot), block_time: new Date(1791733900000 + Number(s.slot) % 1000 * 400).toISOString(), ix_index: 1,
      instruction: nameOf(s.label)!, event: null, account: who ? (a.marginfiAccounts as Record<string, string>)[who] : null, account_label: who, bank: tok ? (a.banks as Record<string, string>)[tok] : null,
      bank_label: tok, amount: amt ? String(BigInt(amt[1].replace(/,/g, '')) * 10n ** BigInt(amt[2] === 'tSOL' ? 9 : 6)) : null, ok: true };
  });
  const liquidationStep = run.steps.find((s) => s.label.includes('liquidate'))!;
  const liquidations: LiquidationItem[] = liquidation ? [{ signature: liquidationStep.signatures[0], slot: String(liquidationStep.slot),
    block_time: new Date(1791733900000 + Number(liquidationStep.slot) % 1000 * 400).toISOString(), ix_index: 1,
    liquidatee_account: a.marginfiAccounts.bob, liquidatee_label: 'bob', asset_bank: a.banks.tSOL, asset_label: 'tSOL',
    liability_bank: a.banks.tUSDC, liability_label: 'tUSDC', seized_asset: 10_000_000_000, repaid_liability: 475_000_000,
    pre_health: -750.001780881723, post_health: -701.2517808817221 }] : [];

  let submitted: { action: string; bank: string; amount: string } | null = null;
  let pendingItem: ActivityItem | null = null;
  const mockSignature = '5mockSignature1111111111111111111111111111111111111111111111111111111111111111111111';
  const history: WalletHistoryItem[] = [
    { time: new Date().toISOString(), kind: 'swap', assets: [{ symbol: 'SOL', amount: '10000000', decimals: 9 }, { symbol: 'tUSDC', amount: '1500000', decimals: 6 }], result: 'confirmed', signature: mockSignature, detail: false },
    { time: new Date(Date.now() - 3600000).toISOString(), kind: 'faucet', assets: [{ symbol: 'tUSDC', amount: '1000000000', decimals: 6 }, { symbol: 'tSOL', amount: '10000000000', decimals: 9 }], result: 'confirmed', signature: mockSignature, detail: false },
    { time: new Date(Date.now() - 7200000).toISOString(), kind: 'deposit', assets: [{ symbol: 'tUSDC', amount: '1000000000', decimals: 6 }], result: '成功', signature: run.steps.find((s) => s.label.includes('bob') && s.label.includes('deposit'))?.signatures[0] ?? mockSignature, detail: true },
  ];
  const swapAssets = [
    { symbol: 'SOL', decimals: 9, usd: '150', source: 'pyth' },
    { symbol: 'tSOL', decimals: 9, usd: '100', source: 'mock' },
    { symbol: 'tUSDC', decimals: 6, usd: '1', source: 'mock' },
    { symbol: 'pSOL', decimals: 9, usd: '108', source: 'pyth' },
    { symbol: 'pBTC', decimals: 8, usd: '84400', source: 'pyth' },
    { symbol: 'pETH', decimals: 8, usd: '2500', source: 'pyth' },
    { symbol: 'tHYPE', decimals: 8, usd: '80', source: 'mock' },
  ] as const;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/swap/rates') return ok({ assets: swapAssets, min_usd: '0.1', max_usd: '10000' });
    if (url.pathname === '/swap/quote') {
      const req = JSON.parse(String(init?.body ?? '{}')) as { wallet: string; from: string; to: string; amount: string };
      const from = swapAssets.find((item) => item.symbol === req.from)!;
      const to = swapAssets.find((item) => item.symbol === req.to)!;
      const inAmount = toNative(req.amount, from.decimals) ?? '0';
      const fromUsd = BigInt(Math.round(Number(from.usd) * 1_000_000));
      const toUsd = BigInt(Math.round(Number(to.usd) * 1_000_000));
      const outAmount = BigInt(inAmount) * fromUsd * 10n ** BigInt(to.decimals) /
        (toUsd * 10n ** BigInt(from.decimals));
      const payer = new PublicKey(req.wallet);
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: PublicKey.default.toBase58(),
        instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 0 })] }).compileToV0Message());
      return ok({ transaction: b64.encode(tx.serialize()), last_valid_block_height: 1, from: from.symbol, to: to.symbol,
        in_amount: inAmount, in_decimals: from.decimals, out_amount: outAmount.toString(), out_decimals: to.decimals,
        summary: `用 ${req.amount} ${from.symbol} 兑换` });
    }
    if (url.pathname === '/swap/send') return ok({ signature: mockSignature, status: 'confirmed', error: null, slot: '1', indexed: true });
    if (url.pathname === '/faucet') return ok({ signatures: [], granted: [], next_allowed_at: new Date().toISOString() });
    if (!url.pathname.startsWith('/api/')) return real(input, init);
    if (url.pathname === '/api/config') return ok({ faucet_url: 'http://localhost:8788/faucet' });
    if (/^\/api\/wallet\/[^/]+\/history$/.test(url.pathname)) {
      const before = url.searchParams.get('before');
      const wallet = decodeURIComponent(url.pathname.split('/')[3]);
      return ok(wallet === a.actors.bob && !before ? { items: history, next_before: null } : { items: [], next_before: null });
    }
    if (url.pathname === '/api/pool') return ok(pool);
    if (url.pathname === '/api/accounts') return ok(accounts);
    if (url.pathname === '/api/activity') {
      const bank = url.searchParams.get('bank');
      const selected = banks.find((b) => b.address === bank);
      const filtered = bank ? items.filter((item) => item.bank === bank || item.instruction === 'lending_account_liquidate' && [a.banks.tSOL, a.banks.tUSDC].includes(bank))
        .map((item) => item.instruction === 'lending_account_liquidate' && selected ? { ...item, bank, bank_label: selected.label } : item) : items;
      return ok({ items: pendingItem ? [pendingItem, ...filtered] : filtered, next_before: null });
    }
    if (url.pathname === '/api/liquidations') {
      const bank = url.searchParams.get('bank');
      return ok(bank ? liquidations.filter((row) => row.asset_bank === bank || row.liability_bank === bank) : liquidations);
    }
    if (url.pathname === '/api/rate-curve') {
      const b = banks.find((x) => x.address === url.searchParams.get('bank')) ?? banks[0];
      const body: RateCurveView = { bank: b.address, label: b.label, points: Array.from({ length: 101 }, (_, i) => rates(i / 100)), current: rates(b.utilization) };
      return ok(body);
    }
    if (url.pathname === '/api/bank-history') {
      const b = banks.find((x) => x.address === url.searchParams.get('bank')) ?? banks[0];
      const points = [0, 1, 2].map((i) => {
        const factor = [70, 85, 100][i], utilization = b.utilization * [0.35, 0.7, 1][i], rate = rates(utilization);
        const native = (amount: string) => String(BigInt(amount) * BigInt(factor) / 100n);
        return { slot: String(509900000 + i * 25000), block_time: new Date(Date.now() - (2 - i) * 86400000).toISOString(),
          total_deposits: native(b.total_deposits), total_borrows: native(b.total_borrows),
          total_deposits_usd: b.total_deposits_usd === null ? null : b.total_deposits_usd * factor / 100,
          total_borrows_usd: b.total_borrows_usd === null ? null : b.total_borrows_usd * factor / 100,
          utilization, lending_apr: rate.lending_apr, borrowing_apr: rate.borrowing_apr };
      });
      return ok({ bank: b.address, label: b.label, points } satisfies BankHistoryView);
    }
    if (url.pathname.startsWith('/api/wallet/')) {
      return ok({ wallet: url.pathname.split('/').pop(), sol_lamports: '2500000000', marginfi_account: null, faucet_url: 'http://localhost:8788',
        tokens: banks.map((b) => ({ bank: b.address, mint: b.mint, label: b.label, decimals: b.decimals,
          amount: ({ tUSDC: '1000000000', tSOL: '10000000000', pSOL: '10000000000', pBTC: '600000', pETH: '20000000', tHYPE: '600000000' } as Record<string, string>)[b.label] ?? '0' })) });
    }
    if (url.pathname === '/api/build') {
      // 假交易：一笔 0 lamports 的自转账，只为让钱包有东西可签。
      const req = JSON.parse(String(init?.body ?? '{}'));
      submitted = { action: req.action, bank: req.bank, amount: req.amount };
      const payer = new PublicKey(req.wallet);
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: PublicKey.default.toBase58(),
        instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 0 })] }).compileToV0Message());
      const tooMuch = req.action === 'borrow' && BigInt(req.amount || '0') > 4000000000n;
      return ok({ transaction: b64.encode(tx.serialize()), last_valid_block_height: 1, creates_account: req.action === 'deposit', marginfi_account: payer.toBase58(),
        summary: `${({ deposit: '存入', withdraw: '取出', borrow: '借出', repay: '还款' } as Record<string, string>)[req.action]} ${req.all ? '全部' : req.amount} (原生单位)`,
        simulation: tooMuch ? { ok: false, logs: [], units_consumed: null, error: { code: 6010, name: 'RiskEngineInitRejected', message: '借款后健康度不足,请减少借款数量或先增加抵押' } }
          : { ok: true, logs: [], units_consumed: 62000, error: null } });
    }
    if (url.pathname === '/api/send') {
      const signature = mockSignature;
      const bank = banks.find((item) => item.address === submitted?.bank);
      const action = submitted?.action ?? 'deposit';
      pendingItem = { signature, slot: '1', block_time: new Date().toISOString(), ix_index: 0, instruction: `lending_account_${action}`,
        event: null, account: a.marginfiAccounts.bob, account_label: 'bob', bank: bank?.address ?? null, bank_label: bank?.label ?? null, amount: submitted?.amount ?? null, ok: true };
      return ok({ signature, status: 'confirmed', error: null, slot: '1', indexed: true });
    }
    const sig = url.pathname.split('/').pop()!;
    const x = (xray as Record<string, unknown>)[sig] ?? Object.values(xray)[0];
    return ok(x);
  };
}
