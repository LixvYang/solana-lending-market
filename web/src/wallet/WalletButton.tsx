/**
 * INPUT: Wallet Adapter connection state and BaseWalletMultiButton.
 * OUTPUT: Localized wallet button with a stable icon and address label.
 * POSITION: Shared wallet control used by the app header and wallet flows.
 *
 * SYNC: Update this header and folder.md when this module changes.
 */
import { BaseWalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';

const labels = {
  'change-wallet': '更换钱包', connecting: '连接中…', 'copy-address': '复制地址', copied: '已复制',
  disconnect: '断开连接', 'has-wallet': '连接钱包', 'no-wallet': '连接钱包',
};

export function WalletButton() {
  const { connected, connecting, publicKey } = useWallet();
  const text = connecting ? '连接中…' : connected && publicKey ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}` : '连接钱包';
  return <BaseWalletMultiButton labels={labels}>
    <><svg className="wallet-button-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="2.5" y="4.5" width="15" height="11" rx="2" /><path d="M2.5 7.5h15M13 11h2" /></svg>{text}</>
  </BaseWalletMultiButton>;
}
