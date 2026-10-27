import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { VersionedTransaction } from '@solana/web3.js';
import type { SendResponse, SwapAsset, SwapRatesView, WalletView } from '@contract';
import { usePoll } from '../hooks';
import { fmtToken, fmtUsd, toNative } from '../format';
import { SourceChip } from '../tokens';
import { b64, deskBase, swap } from '../wallet/chain';
import { TokenPicker } from './TokenPicker';
import { SwapDetails } from './SwapDetails';
import { deskIsShort } from './stock';
import { errorText, useT } from '../i18n';

const KEEP_SOL = 10_000_000n; // 卖出 SOL 时留 0.01 SOL 付手续费和账户租金
/**
 * 兑换页,版式参照 Jupiter / Uniswap:上面"卖出"、下面"买入",中间翻转;一个主按钮,文案告诉你还差什么。
 * 汇率 = 两边资产在借贷池里用的同一个价格(SOL、pSOL 是 Pyth 实时,tSOL、tUSDC 是 mock)。
 * 页面上的数字是预估;点"兑换"时服务端按当时价格报价并锁定数量,你签名的就是这个数量(没有滑点)。
 */
export function SwapPage({ faucetUrl, onDone, wallet: info, onResult, active }: { faucetUrl: string | null; onDone: () => void; wallet: WalletView | null; onResult: (result: SendResponse) => void; active: boolean }) {
  const { t } = useT();
  const { publicKey, signTransaction, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const address = publicKey?.toBase58() ?? null, base = faucetUrl ? deskBase(faucetUrl) : null;
  const rates = usePoll<SwapRatesView | null>(() => (active && base ? swap.rates(base) : Promise.resolve(null)), [base, active], 30_000).data;
  const [from, setFrom] = useState<SwapAsset>('SOL');
  const [to, setTo] = useState<SwapAsset>('pSOL');
  const [amount, setAmount] = useState('');
  const [invert, setInvert] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string; link?: string } | null>(null);

  const asset = (s: SwapAsset) => rates?.assets.find((a) => a.symbol === s);
  const micro = (s: SwapAsset) => BigInt(toNative(asset(s)?.usd ?? '0', 6) ?? '0');
  const dec = (s: SwapAsset) => asset(s)?.decimals ?? (s === 'tUSDC' ? 6 : 9);
  const balance = (s: SwapAsset): bigint | null => !info ? null : s === 'SOL' ? BigInt(info.sol_lamports) : BigInt(info.tokens.find((t) => t.label === s)?.amount ?? '0');
  const spendable = (s: SwapAsset) => { const b = balance(s) ?? 0n; return s === 'SOL' ? (b > KEEP_SOL ? b - KEEP_SOL : 0n) : b; };

  // 和服务端同一个公式(整数、向下取整):预估永远不会比实际到手多。
  const nativeIn = rates && amount ? toNative(amount, dec(from)) : null;
  const inBig = nativeIn ? BigInt(nativeIn) : 0n;
  const out = rates && inBig > 0n && micro(to) > 0n ? inBig * micro(from) * 10n ** BigInt(dec(to)) / (micro(to) * 10n ** BigInt(dec(from))) : null;
  const usdIn = rates && inBig > 0n ? Number(inBig * micro(from) / 10n ** BigInt(dec(from))) / 1e6 : null;
  const minUsd = Number(rates?.min_usd ?? 0), maxUsd = Number(rates?.max_usd ?? 0);
  const stale = [from, to].find((s) => rates && asset(s)?.usd == null);
  const problem = !base ? t.swapNotConfigured : !rates ? t.ratesLoading : stale ? t.priceUnavailable(stale) : !amount || inBig === 0n ? t.enterAmount
    : !nativeIn ? t.invalidAmount : !connected ? null : !info ? t.balanceLoading : inBig > spendable(from) ? t.insufficientBalance(from)
    : usdIn! < minUsd ? t.minTrade(rates!.min_usd) : usdIn! > maxUsd ? t.maxTrade(rates!.max_usd) : deskIsShort(out, asset(to)?.desk_available) ? t.apiDeskInsufficient(to) : null;
  const rate = rates && micro(from) > 0n && micro(to) > 0n ? (invert ? Number(micro(to)) / Number(micro(from)) : Number(micro(from)) / Number(micro(to))) : null;

  const pick = (side: 'from' | 'to') => (s: string) => {
    const v = s as SwapAsset;
    if (side === 'from') { if (v === to) setTo(from); setFrom(v); } else { if (v === from) setFrom(to); setTo(v); }
    setNote(null);
  };
  const flip = () => { setFrom(to); setTo(from); setAmount(out && out > 0n ? fmtToken(out.toString(), dec(to), dec(to)).replace(/,/g, '') : ''); };
  const fill = (part: bigint) => setAmount(fmtToken((spendable(from) / part).toString(), dec(from), dec(from)).replace(/,/g, ''));
  // 余额还没读到时显示 —,不能显示 0(否则会先闪一下"余额不足")。
  const shown = (s: SwapAsset) => { const v = balance(s); return v === null ? '—' : fmtToken(v.toString(), dec(s), 4); };
  const options = (rates?.assets ?? []).map((a) => ({ symbol: a.symbol, balance: balance(a.symbol) === null ? undefined : fmtToken(balance(a.symbol)!.toString(), a.decimals, 4),
    note: a.usd == null ? t.priceUnavailable(a.symbol) : undefined }));

  const exchange = async () => {
    if (!connected) { setVisible(true); return; }
    if (!signTransaction || !base || problem) return;
    setBusy(t.quoteLoading); setNote(null);
    try {
      const quote = await swap.quote(base, { wallet: address!, from, to, amount });
      setBusy(t.confirmInWallet);
      const signed = await signTransaction(VersionedTransaction.deserialize(b64.decode(quote.transaction)));
      setBusy(t.sending);
      const sent = await swap.send(base, b64.encode(signed.serialize()));
      onResult(sent);
      if (sent.status === 'confirmed') { onDone(); setAmount(''); }
      setNote(null);
    } catch (e) { setNote({ ok: false, text: errorText(e, t) }); }
    finally { setBusy(null); }
  };
  const label = busy ?? (!connected ? t.connectWallet : problem ?? t.swap);

  return (
    <div className="swap-wrap">
      <div className="swap card">
        <div className="swap-box">
          <div className="swap-row"><span className="label">{t.sell}</span>
            {connected && <span className="muted">{t.balance} {shown(from)}
              <button className="pill" onClick={() => fill(2n)} type="button">{t.half}</button><button className="pill" onClick={() => fill(1n)} type="button">{t.max}</button></span>}</div>
          <div className="swap-row"><input className="amount" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => { setAmount(e.target.value); setNote(null); }} aria-label={t.sellAmount} />
            <TokenPicker value={from} options={options} onChange={pick('from')} label={t.sellToken} /></div>
          <div className="swap-row muted"><span>{usdIn != null ? fmtUsd(usdIn) : ' '}{usdIn != null && <SourceChip source={asset(from)?.source} />}</span></div>
        </div>
        <div className="flip-wrap"><button className="flip" onClick={flip} type="button" aria-label={t.flipDirection} title={t.flipDirection}>↓↑</button></div>
        <div className="swap-box">
          <div className="swap-row"><span className="label">{t.buyEstimate}</span>{connected && <span className="muted">{t.balance} {shown(to)}</span>}</div>
          <div className="swap-row"><span className="amount out">{out != null && out > 0n ? fmtToken(out.toString(), dec(to), 6) : '0'}</span>
            <TokenPicker value={to} options={options} onChange={pick('to')} label={t.buyToken} /></div>
          <div className="swap-row muted"><span>{usdIn != null ? `≈ ${fmtUsd(usdIn)}` : ' '}{usdIn != null && <SourceChip source={asset(to)?.source} />}</span></div>
        </div>
        {rate != null && inBig > 0n && rates && <SwapDetails rates={rates} from={from} to={to} invert={invert} onInvert={() => setInvert(!invert)}
          open={detailsOpen} onOpen={() => setDetailsOpen(!detailsOpen)} wallet={info} />}
        <button className="btn primary block lg" onClick={exchange} disabled={Boolean(busy) || (connected && Boolean(problem))}>{label}</button>
        {note && <div className={`notice ${note.ok ? 'ok' : 'bad'}`}>{note.ok ? '✓ ' : ''}{note.text}</div>}
      </div>
    </div>
  );
}
