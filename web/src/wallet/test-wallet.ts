import {
  BaseMessageSignerWalletAdapter, WalletName, WalletReadyState, WalletNotConnectedError,
  type SupportedTransactionVersions, type TransactionOrVersionedTransaction,
} from '@solana/wallet-adapter-base';
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';

/**
 * 仅开发用的本地测试钱包：密钥由种子字符串派生，保存在内存里，不连任何浏览器扩展。
 * 作用是让没有 Phantom 的环境(比如自动化测试)也能完整走通 连接 → 签名 → 发送。
 * 种子公开，所以只能放 devnet 测试币。生产构建不会包含它(只在 import.meta.env.DEV 下被创建)。
 */
export class TestWalletAdapter extends BaseMessageSignerWalletAdapter {
  name = 'Test Wallet' as WalletName<'Test Wallet'>;
  url = 'https://localhost';
  icon = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNiIgZmlsbD0iIzJhNzhkNiIvPjwvc3ZnPg==';
  supportedTransactionVersions: SupportedTransactionVersions = new Set(['legacy', 0]);
  readyState = WalletReadyState.Loadable;
  private keypair: Keypair | null = null;
  private _publicKey: PublicKey | null = null;
  constructor(private seed: string) { super(); }
  get publicKey() { return this._publicKey; }
  get connecting() { return false; }

  async connect() {
    // 历史项目名参与地址派生，改动会指向链上不存在的测试钱包。
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`solana-lending-indexer/testwallet/${this.seed}`));
    this.keypair = Keypair.fromSeed(new Uint8Array(digest));
    this._publicKey = this.keypair.publicKey;
    this.emit('connect', this._publicKey);
  }
  async disconnect() { this.keypair = null; this._publicKey = null; this.emit('disconnect'); }

  async signTransaction<T extends TransactionOrVersionedTransaction<this['supportedTransactionVersions']>>(tx: T): Promise<T> {
    if (!this.keypair) throw new WalletNotConnectedError();
    // 服务端可能已带上一次性账户(新 marginfi 账户)的签名；sign 只补上自己的，不会清掉别人的。
    (tx as unknown as VersionedTransaction).sign([this.keypair]);
    return tx;
  }
  async signAllTransactions<T extends TransactionOrVersionedTransaction<this['supportedTransactionVersions']>>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((t) => this.signTransaction(t)));
  }
  async signMessage(_message: Uint8Array): Promise<Uint8Array> {
    // 测试钱包只用于签交易；web3.js 不导出 ed25519 消息签名，这里明确报错而不是假装成功。
    throw new Error('Test Wallet 不支持 signMessage');
  }
}
