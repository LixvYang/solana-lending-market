import { useEffect, useState } from 'react';
import type { ByteSpan, XrayEvent, XrayInstruction, XrayView } from '@contract';
import { api } from './api';
import { fmtTime, short } from './format';
import { ixLabel } from './instructions';
import { explorer } from './wallet/chain';

const color = (i: number) => (i === 0 ? 'var(--ink-3)' : `var(--s${((i - 1) % 8) + 1})`);
// 交易里也有别的程序的指令(设置算力、SPL Token 转账…)，我们不解码它们，只标出是哪个程序、原始字节是什么。
const KNOWN: Record<string, string> = {
  ComputeBudget111111111111111111111111111111: 'Compute Budget(设置算力上限)',
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'SPL Token',
  '11111111111111111111111111111111': 'System',
};
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const bytes = (hex: string) => hex.match(/.{1,2}/g)?.join(' ') ?? '';

function Spans({ spans, hl, setHl }: { spans: ByteSpan[]; hl: string | null; setHl: (l: string | null) => void }) {
  return (
    <div className="hex">{spans.map((s, i) => (
      <span key={i} className={`span ${hl === s.label ? 'on' : ''}`} style={{ ['--c' as string]: color(i) }} title={`${s.label} · offset ${s.offset} · ${s.length} 字节`}
            onMouseEnter={() => setHl(s.label)} onMouseLeave={() => setHl(null)}>{bytes(s.hex)}</span>))}</div>
  );
}

function Fields({ spans, hl, setHl }: { spans: ByteSpan[]; hl: string | null; setHl: (l: string | null) => void }) {
  return <>{spans.map((s, i) => (
    <div key={i} className={`field ${hl === s.label ? 'on' : ''}`} style={{ ['--c' as string]: color(i) }} onMouseEnter={() => setHl(s.label)} onMouseLeave={() => setHl(null)}>
      <span className="k">{s.label}<span className="muted"> · {s.length}B</span></span>
      <span className="v mono">{typeof s.value === 'string' ? s.value : JSON.stringify(s.value)}</span>
    </div>))}</>;
}

function InstructionBlock({ ix, row }: { ix: XrayInstruction; row: Record<string, unknown> | undefined }) {
  const [hl, setHl] = useState<string | null>(null);
  return (
    <div className="block">
      <h3 style={{ margin: '0 0 8px' }}><span className={`ix ${ixLabel(ix.name).kind}`}>{ixLabel(ix.name).label}</span> <span className="mono">{ix.name}</span> <span className="muted">· 顶层指令 #{ix.ix_index}{ix.inner_index != null ? ` / inner #${ix.inner_index}` : ''} · {short(ix.program)}</span></h3>
      {ix.decode_error && <div className="err">解码错误：{ix.decode_error}</div>}
      <div className="xgrid">
        <div className="xcol"><h3>① 链上原始字节 <span>{ix.data_hex.length / 2} 字节</span></h3>
          <Spans spans={ix.spans} hl={hl} setHl={setHl} />
          <p className="muted" style={{ fontSize: 12 }}>RPC 返回的是 base58：<span className="mono" style={{ wordBreak: 'break-all' }}>{ix.data_base58}</span></p></div>
        <div className="xcol"><h3>② 解码结果 <span>discriminator + 参数</span></h3>
          <Fields spans={ix.spans} hl={hl} setHl={setHl} />
          <h3 style={{ marginTop: 12 }}>账户 <span>按 IDL 命名</span></h3>
          {Object.entries(ix.accounts).map(([k, v]) => <div key={k} className="field"><span className="k">{k}</span><span className="v mono" title={v}>{short(v, 6)}</span></div>)}
          {ix.remaining.length > 0 && <div className="muted" style={{ fontSize: 12 }}>另有 {ix.remaining.length} 个 remaining accounts（价格账户与 bank，用于健康度检查）</div>}</div>
        <div className="xcol"><h3>③ 数据库行 <span>instructions 表</span></h3><pre className="json">{row ? pretty(row) : '（没有对应的行）'}</pre></div>
      </div>
    </div>
  );
}

function OtherInstruction({ ix }: { ix: XrayInstruction }) {
  return (
    <div className="field" style={{ display: 'block' }}>
      <b>{KNOWN[ix.program] ?? short(ix.program, 6)}</b>
      <span className="muted"> · 指令 #{ix.ix_index}{ix.inner_index != null ? ` / inner #${ix.inner_index}` : ''} · 不是 marginfi，未解码</span>
      <div className="mono" style={{ whiteSpace: 'normal', wordBreak: 'break-all', marginTop: 4 }}>{bytes(ix.data_hex)}</div>
    </div>
  );
}

function EventBlock({ ev, row }: { ev: XrayEvent; row: Record<string, unknown> | undefined }) {
  return (
    <div className="block">
      <h3 style={{ margin: '0 0 8px' }}><span className="mono">{ev.name}</span> <span className="muted">· 属于指令 #{ev.ix_index} · 日志第 {ev.log_index} 行</span></h3>
      <div className="xgrid">
        <div className="xcol"><h3>① 日志里的 <span>Program data (base64)</span></h3><pre className="json">{ev.base64}</pre></div>
        <div className="xcol"><h3>② 解码结果 <span>前 8 字节 discriminator 匹配事件名</span></h3><pre className="json">{pretty(ev.data)}</pre></div>
        <div className="xcol"><h3>③ 数据库行 <span>events 表</span></h3><pre className="json">{row ? pretty(row) : '（没有对应的行）'}</pre></div>
      </div>
    </div>
  );
}

const rowOf = (view: XrayView, ix: XrayInstruction) =>
  view.rows.instructions.find((r) => r.ix_index === ix.ix_index && r.inner_index === (ix.inner_index ?? -1));

export function Xray({ signature, onClose }: { signature: string; onClose: () => void }) {
  const [view, setView] = useState<XrayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.xray(signature).then(setView).catch((e) => setError(String(e.message ?? e))); }, [signature]);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(signature).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }, () => {});
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="交易拆解">
        <header>
          <div><h1>交易拆解</h1>
            <div className="sub mono" style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>{signature}</div>
            <div className="sub">{view && <>slot {view.slot} · {fmtTime(view.block_time)} · <span className={`chip ${view.err ? 'bad' : 'ok'}`}>{view.err ? '失败' : '成功'}</span> · </>}
              <button className="linkish" onClick={copy}>{copied ? '已复制' : '复制签名'}</button> · <a href={explorer(signature)} target="_blank" rel="noreferrer">在 Solana Explorer 打开 ↗</a></div></div>
          <button className="btn sm" onClick={onClose} aria-label="关闭">关闭 <span className="muted">Esc</span></button>
        </header>
        {/* 三栏是同一件事的三种样子；先告诉读者怎么看，再给数据。 */}
        <ol className="steps">
          <li><b>链上原始字节</b><span>交易里实际存的数据，按字段着色</span></li>
          <li><b>解码结果</b><span>按 IDL 把字节读成字段；鼠标移到任一段，两边同步高亮</span></li>
          <li><b>数据库行</b><span>存进数据库后的样子</span></li>
        </ol>
        {error && <div className="err">{error}</div>}
        {!view && !error && <div className="muted">加载中…</div>}
        {view && <>
          {/* 有数据库行的才是 marginfi 指令(只有它们会被解码入库)；其余折叠到下面。 */}
          {view.instructions.filter((ix) => rowOf(view, ix)).map((ix) => <InstructionBlock key={`${ix.ix_index}:${ix.inner_index}`} ix={ix} row={rowOf(view, ix)} />)}
          {view.events.map((ev) => <EventBlock key={ev.log_index} ev={ev} row={view.rows.events.find((r) => r.log_index === ev.log_index)} />)}
          {view.instructions.some((ix) => !rowOf(view, ix)) && (
            <details className="data"><summary>其他程序的指令（{view.instructions.filter((ix) => !rowOf(view, ix)).length} 条，未解码）</summary>
              {view.instructions.filter((ix) => !rowOf(view, ix)).map((ix) => <OtherInstruction key={`${ix.ix_index}:${ix.inner_index}`} ix={ix} />)}
            </details>)}
          <details className="data"><summary>原始日志（{view.logs.length} 行）</summary><pre className="json">{view.logs.join('\n')}</pre></details>
        </>}
      </aside>
    </>
  );
}
