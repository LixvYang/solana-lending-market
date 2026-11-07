import { useEffect, useState } from 'react';
import type { ByteSpan, XrayEvent, XrayInstruction, XrayView } from '@contract';
import { api } from './api';
import { fmtTime, short } from './format';
import { ixLabel } from './instructions';
import { explorer } from './wallet/chain';
import { errorText, useT } from './i18n';

const color = (i: number) => (i === 0 ? 'var(--ink-3)' : `var(--s${((i - 1) % 8) + 1})`);
// 交易里也有别的程序的指令(设置算力、SPL Token 转账…)，我们不解码它们，只标出是哪个程序、原始字节是什么。
const KNOWN: Record<string, string> = {
  ComputeBudget111111111111111111111111111111: 'Compute Budget',
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'SPL Token',
  '11111111111111111111111111111111': 'System',
};
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const bytes = (hex: string) => hex.match(/.{1,2}/g)?.join(' ') ?? '';

function Spans({ spans, hl, setHl }: { spans: ByteSpan[]; hl: string | null; setHl: (l: string | null) => void }) {
  const { t } = useT();
  return (
    <div className="hex">{spans.map((s, i) => (
      <span key={i} className={`span ${hl === s.label ? 'on' : ''}`} style={{ ['--c' as string]: color(i) }} title={t.xraySpanTitle(s.label, s.offset, s.length)}
            onMouseEnter={() => setHl(s.label)} onMouseLeave={() => setHl(null)}>{bytes(s.hex)}</span>))}</div>
  );
}

function Fields({ spans, hl, setHl }: { spans: ByteSpan[]; hl: string | null; setHl: (l: string | null) => void }) {
  const { t } = useT();
  return <>{spans.map((s, i) => (
    <div key={i} className={`field ${hl === s.label ? 'on' : ''}`} style={{ ['--c' as string]: color(i) }} onMouseEnter={() => setHl(s.label)} onMouseLeave={() => setHl(null)}>
      <span className="k">{s.label}<span className="muted">, {s.length}B</span></span>
      <span className="v mono">{typeof s.value === 'string' ? s.value : JSON.stringify(s.value)}</span>
    </div>))}</>;
}

function InstructionBlock({ ix, row }: { ix: XrayInstruction; row: Record<string, unknown> | undefined }) {
  const { t } = useT();
  const [hl, setHl] = useState<string | null>(null);
  return (
    <div className="block">
      <h3 style={{ margin: '0 0 8px' }}><span className={`ix ${ixLabel(ix.name, t).kind}`}>{ixLabel(ix.name, t).label}</span> <span className="mono">{ix.name}</span> <span className="muted">{t.xrayTopInstruction(ix.ix_index, ix.inner_index, short(ix.program))}</span></h3>
      {ix.decode_error && <div className="err">{t.xrayDecodeError(ix.decode_error)}</div>}
      <div className="xgrid">
        <div className="xcol"><h3>① {t.xrayRawBytes} <span>{t.xrayBytes(ix.data_hex.length / 2)}</span></h3>
          <Spans spans={ix.spans} hl={hl} setHl={setHl} />
          <p className="muted" style={{ fontSize: 12 }}>{t.xrayRpcBase58}<span className="mono" style={{ wordBreak: 'break-all' }}>{ix.data_base58}</span></p></div>
        <div className="xcol"><h3>② {t.xrayDecoded} <span>{t.xrayDiscriminatorParams}</span></h3>
          <Fields spans={ix.spans} hl={hl} setHl={setHl} />
          <h3 style={{ marginTop: 12 }}>{t.xrayAccounts} <span>{t.xrayIdlNames}</span></h3>
          {Object.entries(ix.accounts).map(([k, v]) => <div key={k} className="field"><span className="k">{k}</span><span className="v mono" title={v}>{short(v, 6)}</span></div>)}
          {ix.remaining.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{t.xrayRemaining(ix.remaining.length)}</div>}</div>
        <div className="xcol"><h3>③ {t.xrayDatabaseRow} <span>{t.xrayInstructionTable}</span></h3><pre className="json">{row ? pretty(row) : t.xrayMissingRow}</pre></div>
      </div>
    </div>
  );
}

function OtherInstruction({ ix }: { ix: XrayInstruction }) {
  const { t } = useT();
  return (
    <div className="field" style={{ display: 'block' }}>
      <b>{KNOWN[ix.program] ?? short(ix.program, 6)}</b>
      <span className="muted">{t.xrayOtherProgram} #{ix.ix_index}{ix.inner_index != null ? ` / inner #${ix.inner_index}` : ''}</span>
      <div className="mono" style={{ whiteSpace: 'normal', wordBreak: 'break-all', marginTop: 4 }}>{bytes(ix.data_hex)}</div>
    </div>
  );
}

function EventBlock({ ev, row }: { ev: XrayEvent; row: Record<string, unknown> | undefined }) {
  const { t } = useT();
  return (
    <div className="block">
      <h3 style={{ margin: '0 0 8px' }}><span className="mono">{ev.name}</span> <span className="muted">{t.xrayEventBelongs(ev.ix_index, ev.log_index)}</span></h3>
      <div className="xgrid">
        <div className="xcol"><h3>① {t.xrayProgramData} <span>{t.xrayProgramDataFormat}</span></h3><pre className="json">{ev.base64}</pre></div>
        <div className="xcol"><h3>② {t.xrayDecoded} <span>{t.xrayDiscriminatorMatch}</span></h3><pre className="json">{pretty(ev.data)}</pre></div>
        <div className="xcol"><h3>③ {t.xrayDatabaseRow} <span>{t.xrayEventTable}</span></h3><pre className="json">{row ? pretty(row) : t.xrayMissingRow}</pre></div>
      </div>
    </div>
  );
}

const rowOf = (view: XrayView, ix: XrayInstruction) =>
  view.rows.instructions.find((r) => r.ix_index === ix.ix_index && r.inner_index === (ix.inner_index ?? -1));

export function Xray({ signature, onClose }: { signature: string; onClose: () => void }) {
  const { t, locale } = useT();
  const [view, setView] = useState<XrayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 404 = 这笔交易不在借贷市场的记录里(例如兑换、普通转账);不要把后端的 "not found" 原样给用户看。
  useEffect(() => { api.xray(signature).then(setView).catch((e) => { const message = errorText(e, t); setError(/not found|404/i.test(message) ? t.xrayNoTransaction : message); }); }, [signature]);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(signature).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }, () => {});
  return (
    <>
      <div className="scrim" onClick={onClose} />
  <aside className="drawer" role="dialog" aria-label={t.xrayTitle}>
        <header>
          <div><h1>{t.xrayTitle}</h1>
            <div className="sub mono" style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>{signature}</div>
            <div className="sub">{view && <>slot {view.slot}, {fmtTime(view.block_time, locale)}, <span className={`chip ${view.err ? 'bad' : 'ok'}`}>{view.err ? t.failed : t.success}</span>, </>}
              <button className="linkish" onClick={copy}>{copied ? t.copied : t.xrayCopySignature}</button>, <a href={explorer(signature)} target="_blank" rel="noreferrer">{t.xrayOpenExplorer}</a></div></div>
          <button className="btn sm" onClick={onClose} aria-label={t.xrayClose}>{t.xrayClose} <span className="muted">Esc</span></button>
        </header>
        {/* 三栏是同一件事的三种样子；先告诉读者怎么看，再给数据。 */}
        <ol className="steps">
          <li><b>{t.xrayRawBytes}</b><span>{t.xrayRawExplanation}</span></li>
          <li><b>{t.xrayDecoded}</b><span>{t.xrayDecodedExplanation}</span></li>
          <li><b>{t.xrayDatabaseRow}</b><span>{t.xrayDatabaseExplanation}</span></li>
        </ol>
        {error && <div className="err">{error}</div>}
        {!view && !error && <div className="muted">{t.xrayLoading}</div>}
        {view && <>
          {/* 有数据库行的才是 marginfi 指令(只有它们会被解码入库)；其余折叠到下面。 */}
          {view.instructions.filter((ix) => rowOf(view, ix)).map((ix) => <InstructionBlock key={`${ix.ix_index}:${ix.inner_index}`} ix={ix} row={rowOf(view, ix)} />)}
          {view.events.map((ev) => <EventBlock key={ev.log_index} ev={ev} row={view.rows.events.find((r) => r.log_index === ev.log_index)} />)}
          {view.instructions.some((ix) => !rowOf(view, ix)) && (
            <details className="data"><summary>{t.xrayOtherInstructions(view.instructions.filter((ix) => !rowOf(view, ix)).length)}</summary>
              {view.instructions.filter((ix) => !rowOf(view, ix)).map((ix) => <OtherInstruction key={`${ix.ix_index}:${ix.inner_index}`} ix={ix} />)}
            </details>)}
          <details className="data"><summary>{t.xrayRawLogs(view.logs.length)}</summary><pre className="json">{view.logs.join('\n')}</pre></details>
        </>}
      </aside>
    </>
  );
}
