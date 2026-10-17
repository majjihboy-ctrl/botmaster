import { useEffect, useMemo, useRef, useState } from 'react';

export interface MarketSymbol {
    underlying_symbol: string;
    underlying_symbol_name: string;
    market: string;
    market_display_name?: string;
    submarket_display_name?: string;
    exchange_is_open: number;
}

// Order the groups the way a trader expects them; anything unknown goes last.
const GROUP_ORDER = ['forex', 'indices', 'commodities', 'synthetic_index', 'cryptocurrency'];

interface Props {
    symbols: MarketSymbol[];
    value: string;
    onChange: (symbol: string) => void;
}

const MarketPicker = ({ symbols, value, onChange }: Props) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
    const rootRef = useRef<HTMLDivElement>(null);

    const groups = useMemo(() => {
        const m = new Map<string, { name: string; order: number; items: MarketSymbol[] }>();
        for (const s of symbols) {
            const id = s.market || 'other';
            if (!m.has(id)) {
                const idx = GROUP_ORDER.indexOf(id);
                m.set(id, { name: s.market_display_name ?? id, order: idx === -1 ? 99 : idx, items: [] });
            }
            m.get(id)!.items.push(s);
        }
        const list = Array.from(m.entries()).map(([id, g]) => ({ id, ...g }));
        list.forEach(g =>
            g.items.sort(
                (a, b) =>
                    (a.submarket_display_name ?? '').localeCompare(b.submarket_display_name ?? '') ||
                    a.underlying_symbol_name.localeCompare(b.underlying_symbol_name)
            )
        );
        return list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    }, [symbols]);

    const current = symbols.find(s => s.underlying_symbol === value);
    const q = query.trim().toLowerCase();
    const searching = q.length > 0;

    // close when tapping anywhere outside the picker
    useEffect(() => {
        if (!open) return;
        const away = (e: MouseEvent | TouchEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', away);
        document.addEventListener('touchstart', away);
        return () => {
            document.removeEventListener('mousedown', away);
            document.removeEventListener('touchstart', away);
        };
    }, [open]);

    const toggleOpen = () => {
        setOpen(o => {
            if (!o) {
                // open with the group of the current market already expanded
                if (current) setOpenGroups({ [current.market]: true });
                setQuery('');
            }
            return !o;
        });
    };

    const pick = (symbol: string) => {
        onChange(symbol);
        setOpen(false);
    };

    return (
        <div className='forex-trader__market' ref={rootRef}>
            <span>Market</span>
            <button type='button' className='market-picker__button' onClick={toggleOpen} aria-expanded={open}>
                <span className='market-picker__current'>
                    {current ? current.underlying_symbol_name : value}
                </span>
                <span className={`market-picker__arrow${open ? ' is-open' : ''}`}>▾</span>
            </button>
            {open && (
                <div className='market-picker__menu'>
                    <input
                        className='market-picker__search'
                        placeholder='Search a market…'
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                    />
                    <div className='market-picker__list'>
                        {groups.length === 0 && <div className='market-picker__empty'>Loading markets…</div>}
                        {groups.map(g => {
                            const items = searching
                                ? g.items.filter(
                                      s =>
                                          s.underlying_symbol_name.toLowerCase().includes(q) ||
                                          s.underlying_symbol.toLowerCase().includes(q)
                                  )
                                : g.items;
                            if (searching && items.length === 0) return null;
                            const expanded = searching || !!openGroups[g.id];
                            let lastSub = '';
                            return (
                                <div key={g.id} className='market-picker__group'>
                                    <button
                                        type='button'
                                        className='market-picker__group-head'
                                        onClick={() => setOpenGroups(o => ({ ...o, [g.id]: !o[g.id] }))}
                                    >
                                        <span className={`market-picker__arrow${expanded ? ' is-open' : ''}`}>▸</span>
                                        <span className='market-picker__group-name'>{g.name}</span>
                                        <span className='market-picker__count'>{items.length}</span>
                                    </button>
                                    {expanded &&
                                        items.map(s => {
                                            const sub = s.submarket_display_name ?? '';
                                            const showSub = !!sub && sub !== lastSub;
                                            lastSub = sub;
                                            return (
                                                <div key={s.underlying_symbol}>
                                                    {showSub && <div className='market-picker__sub'>{sub}</div>}
                                                    <button
                                                        type='button'
                                                        className={`market-picker__item${
                                                            s.underlying_symbol === value ? ' is-active' : ''
                                                        }`}
                                                        onClick={() => pick(s.underlying_symbol)}
                                                    >
                                                        {s.underlying_symbol_name}
                                                        {s.exchange_is_open === 0 && (
                                                            <span className='market-picker__closed'>closed</span>
                                                        )}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default MarketPicker;
