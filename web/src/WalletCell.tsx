/** INPUT: Solana 钱包地址与 marginfi 账户地址(及可选名字)。 OUTPUT: 钱包为主、marginfi 账户为辅的两行单元格。 POSITION: 链上数据页两张表共用。 */
import { short } from './format';
import { useT } from './i18n';
import { explorerAddress } from './wallet/chain';

// 用户认得的是自己的钱包;marginfi 账户是钱包名下的借贷账户(一个钱包可以有多个),放第二行作辅助信息。
export function WalletCell({ wallet, account, name }: { wallet: string | null; account: string | null; name: string | null }) {
  const { t } = useT();
  if (!wallet) return name ? <><b>{name}</b><div className="muted mono">{short(account)}</div></> : <span className="mono">{short(account)}</span>;
  return <div className="wallet-cell">
    <a className={name ? undefined : 'mono'} href={explorerAddress(wallet)} target="_blank" rel="noreferrer" title={wallet}>{name ?? short(wallet)}</a>
    <div className="muted" title={`${t.marginfiAccount} ${account ?? ''}`}>{t.marginfiAccount} <span className="mono">{short(account)}</span></div>
  </div>;
}
