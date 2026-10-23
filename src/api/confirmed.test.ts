import test from 'node:test';
import assert from 'node:assert/strict';
import run from '../../fixtures/m1-run.json';
import txs from '../../fixtures/m1-transactions.json';
import accounts from '../../fixtures/m1-accounts.json';
import { PublicKey, type VersionedTransactionResponse } from '@solana/web3.js';
import { decodeBase58, encodeBase58 } from '../core/base58';
import type { RawTransaction } from '../ingest/rpc';
import type { WalletRpc } from './wallet-rpc';
import { indexConfirmed } from './confirmed';
import { fakeRpc, feedInfo, mockOwner } from './wallet-test-utils';
import { seedApi } from './test-utils';
import { route } from './server';

test('confirmed transactions are immediately available in activity and saved as optimistic', async () => {
  const db = await seedApi();
  try {
    const source = (txs.transactions as Record<string, RawTransaction>)['2iKLGS3m3TPhoFiJdsd8frR72jxv8r6PCgti2rBqvXNtxVvjTGZ3inTEL68uzSExmgzFQC3SaaaXHFbK5eg5mWrL'];
    const signature = encodeBase58(Buffer.alloc(64, 23));
    const raw: RawTransaction = { ...source, slot: 300, transaction: { ...source.transaction, signatures: [signature, ...source.transaction.signatures.slice(1)] } };
    const keys = raw.transaction.message.accountKeys.map(key => new PublicKey(key));
    const transactionResponse = {
      slot: raw.slot, blockTime: raw.blockTime, version: 0,
      transaction: { signatures: raw.transaction.signatures, message: {
        staticAccountKeys: keys,
        compiledInstructions: raw.transaction.message.instructions.map(ix => ({ programIdIndex: ix.programIdIndex,
          accountKeyIndexes: ix.accounts, data: decodeBase58(ix.data) })),
      } },
      meta: { ...raw.meta, loadedAddresses: { writable: [], readonly: [] }, innerInstructions: null },
    } as unknown as VersionedTransactionResponse;
    const rpc = fakeRpc({ getTransaction: async () => transactionResponse } as unknown as Partial<WalletRpc>) as WalletRpc;
    rpc.getMultipleAccountsInfoAndContext = async addresses => ({ context: { slot: 301 }, value: addresses.map(address => {
      const value = (accounts.accounts as Record<string, { owner: string; lamports: number; data: string }>)[address.toBase58()];
      if (value) return { owner: new PublicKey(value.owner), lamports: value.lamports, data: Buffer.from(value.data, 'base64'), executable: false, rentEpoch: 0 };
      if (Object.values(run.addresses.feeds).includes(address.toBase58())) {
        const feed = feedInfo();
        return { ...feed, owner: feed.owner, data: Buffer.from(feed.data) };
      }
      return null;
    }) });
    await indexConfirmed(db, rpc, signature, new Set([mockOwner.toBase58()]));
    const response = await route(db, 'GET', '/api/activity');
    const page = JSON.parse(response.body) as { items: { signature: string }[] };
    assert.equal(response.status, 200);
    assert.ok(page.items.some(item => item.signature === signature));
    const stored = await db.query('SELECT finalized FROM raw_tx WHERE signature=$1', [signature]);
    assert.equal(stored.rows[0].finalized, false);
  } finally { await db.close(); }
});
