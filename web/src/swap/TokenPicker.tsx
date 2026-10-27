import { useEffect, useRef, useState } from 'react';
import { TokenIcon, tokenMeta } from '../tokens';
import { useT } from '../i18n';

export interface PickerOption { symbol: string; balance?: string; note?: string }

/** 带图标的代币选择器:按钮显示当前代币,点开是列表(图标、名称、余额)。Esc 或点外面关闭。 */
export function TokenPicker({ value, options, onChange, label }: { value: string; options: PickerOption[]; onChange: (symbol: string) => void; label: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="picker" ref={box}>
      <button type="button" className="picker-btn" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} aria-label={label}>
        <TokenIcon symbol={value} size={24} /><b>{value}</b><svg className="chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="m2 4 4 4 4-4" /></svg>
      </button>
      {open && (
        <ul className="picker-list" role="listbox" aria-label={label}>
          {options.map((o) => (
            <li key={o.symbol} role="option" aria-selected={o.symbol === value}>
              <button type="button" className={o.symbol === value ? 'on' : ''} onClick={() => { onChange(o.symbol); setOpen(false); }}>
                <TokenIcon symbol={o.symbol} size={30} />
                <span className="pl-name"><b>{o.symbol}</b><span className="muted">{o.note ?? tokenMeta(o.symbol, t).name}</span></span>
                {o.balance !== undefined && <span className="pl-bal">{o.balance}</span>}
              </button>
            </li>))}
        </ul>)}
    </div>
  );
}
