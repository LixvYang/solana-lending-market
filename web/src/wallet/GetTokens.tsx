import { useEffect, useState } from 'react';
import type { FaucetQuotaView, FaucetResponse, WalletTokenView } from '@contract';
import { fmtToken } from '../format';
import { TokenIcon } from '../tokens';
import { chain } from './chain';
import { apiErrorText, errorText, useT } from '../i18n';

/** 免费领测试币(有限流)。想要更多或换成别的币,去"兑换"页。 */
export function GetTokens({ address, faucetUrl, tokens, onDone }: {
  address: string; faucetUrl: string; tokens: WalletTokenView[]; onDone: () => void;
}) {
  const { t, locale } = useT();
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<FaucetQuotaView | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const refreshQuota = () => chain.faucetConfig(faucetUrl).then((value) => setQuota(value.quota)).catch(() => setQuota(null));
  useEffect(() => { void refreshQuota(); }, [faucetUrl]);
  const decimals = (label: string) => tokens.find((t) => t.label === label)?.decimals ?? 9;
  const claim = async () => {
    setBusy(true); setNote(null);
    try {
      const r: FaucetResponse = await chain.faucet(faucetUrl, address);
      await refreshQuota();
      onDone();
      setNote({ ok: true, text: t.claimSuccess(r.granted.map((g) => `${fmtToken(g.amount, decimals(g.label))} ${g.label}`).join(locale === 'zh' ? '、' : ', ')) });
    } catch (e) { setNote({ ok: false, text: errorText(e, t) }); }
    finally { setBusy(false); }
  };
  return (
    <div className="faucet">
      <div className="faucet-icons" aria-hidden>{tokens.map((t) => <TokenIcon key={t.mint} symbol={t.label} size={22} />)}</div>
      <button className="btn" onClick={claim} disabled={busy}>{busy ? t.claimLoading : t.getTestTokens}</button>
      {/* 名额用完时直接告诉几点恢复，不让用户点了才知道。 */}
      {quota && <span className="muted">{quota.remaining === 0 && quota.resets_at ? apiErrorText('FAUCET_WINDOW_FULL', { next: quota.resets_at }, t, '') : t.faucetQuota(quota.remaining)}</span>}
      {note && <div className={`notice ${note.ok ? 'ok' : 'bad'}`}>{note.text}</div>}
    </div>
  );
}
