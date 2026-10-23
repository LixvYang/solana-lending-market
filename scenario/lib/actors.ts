import { createHash } from 'node:crypto';
import { Keypair } from '@solana/web3.js';

export const people = ['alice', 'bob', 'carol'] as const;
export const tokens = ['tUSDC', 'tSOL'] as const;
export type Person = typeof people[number];
export type Token = typeof tokens[number];

// #region ep3-actors
// 教学账户的种子公开，任何人都能签名；只用于 devnet，不能存真实资产。
// 历史项目名参与地址派生，改动会指向链上不存在的账户。
export function deriveKeypair(label: string): Keypair {
  const seed = createHash('sha256').update(`solana-lending-indexer/${label}`).digest();
  return Keypair.fromSeed(seed);
}
// #endregion

export function createActors(runId = '') {
  // 新的一次拍摄用新 group；mint 和参与者复用，避免覆盖旧借贷账户。
  const scope = (label: string) => runId ? `${label}/${runId}` : label;
  return {
    alice: deriveKeypair('alice'), bob: deriveKeypair('bob'), carol: deriveKeypair('carol'),
    group: deriveKeypair(scope('group')),
    mints: { tUSDC: deriveKeypair('mint/tUSDC'), tSOL: deriveKeypair('mint/tSOL') },
    banks: { tUSDC: deriveKeypair(scope('bank/tUSDC')), tSOL: deriveKeypair(scope('bank/tSOL')) },
    marginfiAccounts: {
      alice: deriveKeypair(scope('marginfi/alice')), bob: deriveKeypair(scope('marginfi/bob')),
      carol: deriveKeypair(scope('marginfi/carol')),
    },
  };
}
export type Actors = ReturnType<typeof createActors>;
