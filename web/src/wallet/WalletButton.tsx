/**
 * INPUT: Wallet Adapter connection state and BaseWalletMultiButton.
 * OUTPUT: Localized wallet button with a stable icon and address label.
 * POSITION: Shared wallet control used by the app header and wallet flows.
 *
 * SYNC: Update this header and folder.md when this module changes.
 */
import { BaseWalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import { useT } from '../i18n';

export function WalletButton() {
  const { t } = useT();
  const { connected, connecting, publicKey } = useWallet();
  const labels = { 'change-wallet': t.walletChange, connecting: t.connecting, 'copy-address': t.copyAddress, copied: t.copied, disconnect: t.disconnect, 'has-wallet': t.connectWallet, 'no-wallet': t.connectWallet };
  const text = connecting ? t.connecting : connected && publicKey ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}` : t.connectWallet;
  return <BaseWalletMultiButton labels={labels}>
    <><svg className="wallet-button-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="2.5" y="4.5" width="15" height="11" rx="2" /><path d="M2.5 7.5h15M13 11h2" /></svg><span>{text}</span></>
  </BaseWalletMultiButton>;
}
