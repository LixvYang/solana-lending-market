/** INPUT: confirmed RPC transaction. OUTPUT: optimistic raw row plus current protocol/oracle snapshots. POSITION: send path fast indexing. */
import { PublicKey, type VersionedTransactionResponse } from '@solana/web3.js';
import type { Db } from '../store/db';
import { insertRawTx } from '../store/raw';
import { decodePending } from '../store/decode';
import { snapshotAccounts, snapshotOracles } from '../store/accounts';
import { oracleAccountOf } from '../oracle/pyth';
import { encodeBase58 } from '../core/base58';
import { marginfiIdl } from '../decoder/idl';
import type { RawTransaction } from '../ingest/rpc';
import type { WalletRpc } from './wallet-rpc';

export function rawTransaction(tx: VersionedTransactionResponse): RawTransaction {
  const message = tx.transaction.message;
  if (!('staticAccountKeys' in message)) throw new Error('expected v0 transaction');
  const instructions = message.compiledInstructions.map(ix => ({
    programIdIndex: ix.programIdIndex, accounts: [...ix.accountKeyIndexes], data: encodeBase58(ix.data),
  }));
  const innerInstructions = tx.meta?.innerInstructions?.map(group => ({ index: group.index, instructions: group.instructions.map(ix => ({
    programIdIndex: ix.programIdIndex, accounts: [...ix.accounts], data: ix.data,
  })) })) ?? null;
  return { slot: tx.slot, blockTime: tx.blockTime ?? null, version: 0,
    transaction: { signatures: tx.transaction.signatures, message: { accountKeys: message.staticAccountKeys.map(key => key.toBase58()), instructions } },
    meta: tx.meta ? { err: tx.meta.err, logMessages: tx.meta.logMessages, loadedAddresses: tx.meta.loadedAddresses
      ? { writable: tx.meta.loadedAddresses.writable.map(key => key.toBase58()), readonly: tx.meta.loadedAddresses.readonly.map(key => key.toBase58()) } : undefined,
      innerInstructions } : null };
}

const protocolRoles = new Set(['bank', 'asset_bank', 'liab_bank', 'group', 'marginfi_group', 'marginfi_account',
  'liquidator_marginfi_account', 'liquidatee_marginfi_account']);

/** The optimistic row remains eligible for finality cleanup if confirmed is later rolled back. */
export async function indexConfirmed(db: Db, rpc: WalletRpc, signature: string, oracleOwners?: Set<string>) {
  const response = await rpc.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 });
  if (!response) throw new Error('confirmed transaction not available');
  const raw = rawTransaction(response);
  if (raw.transaction.signatures[0] !== signature || raw.meta?.err != null) throw new Error('confirmed transaction mismatch');
  await insertRawTx(db, raw, false);
  await decodePending(db, marginfiIdl);
  const rows = (await db.query('SELECT accounts FROM instructions WHERE signature=$1', [signature])).rows;
  const accounts = [...new Set(rows.flatMap(row => Object.entries(row.accounts as Record<string, string>)
    .filter(([role]) => protocolRoles.has(role)).map(([, address]) => address)))];
  if (!accounts.length) throw new Error('no marginfi accounts decoded');
  const accountRpc = { getMultipleAccounts: async (addresses: string[]) => {
    const response = await rpc.getMultipleAccountsInfoAndContext(addresses.map(address => new PublicKey(address)), { commitment: 'confirmed' });
    return { context: { slot: response.context.slot }, value: response.value.map(account => account ? {
      owner: account.owner.toBase58(), lamports: account.lamports, data: [account.data.toString('base64'), 'base64'] as [string, 'base64'],
    } : null) };
  } };
  await snapshotAccounts(db, accountRpc, accounts, marginfiIdl, true);
  const bankRows = (await db.query(`SELECT address,data FROM account_states WHERE address=ANY($1::text[]) AND type='Bank'
    AND slot=(SELECT MAX(s.slot) FROM account_states s WHERE s.address=account_states.address)`, [accounts])).rows;
  const oracles = [...new Set(bankRows.flatMap(row => {
    const config = (row.data as { config?: { oracle_setup: unknown; oracle_keys: string[] } }).config;
    const oracle = config?.oracle_keys ? oracleAccountOf(config) : null;
    return oracle ? [oracle] : [];
  }))];
  if (oracles.length) await snapshotOracles(db, accountRpc, oracles, oracleOwners);
}
