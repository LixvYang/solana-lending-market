import { useState } from 'react';
import type { FaucetResponse, WalletTokenView } from '@contract';
import { fmtToken } from '../format';
import { TokenIcon } from '../tokens';
import { chain } from './chain';

/** 免费领测试币(有限流)。想要更多或换成别的币,去"兑换"页。 */
export function GetTokens({ address, faucetUrl, tokens, onDone }: {
  address: string; faucetUrl: string; tokens: WalletTokenView[]; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const decimals = (label: string) => tokens.find((t) => t.label === label)?.decimals ?? 9;
  const claim = async () => {
    setBusy(true); setNote(null);
    try {
      const r: FaucetResponse = await chain.faucet(faucetUrl, address);
      onDone();
      setNote({ ok: true, text: `已到账:${r.granted.map((g) => `${fmtToken(g.amount, decimals(g.label))} ${g.label}`).join('、')}` });
    } catch (e) { setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };
  return (
    <div className="faucet">
      <div className="faucet-icons" aria-hidden>{tokens.map((t) => <TokenIcon key={t.mint} symbol={t.label} size={22} />)}</div>
      <button className="btn" onClick={claim} disabled={busy}>{busy ? '领取中…' : '领取测试币'}</button>
      {note && <div className={`notice ${note.ok ? 'ok' : 'bad'}`}>{note.text}</div>}
    </div>
  );
}
