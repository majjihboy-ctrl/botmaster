import { useMemo, useState } from 'react';
import { formatMoney, pickToClose, summarize, type CloseFilter, type Position } from './trade-engine';

interface Props {
    positions: Position[];
    currency: string;
    /** The market on the chart, for the "this market only" switch. */
    symbol: string;
    onClose: (list: Position[]) => void;
}

const sign = (n: number | null) => (n === null || n === 0 ? '' : n > 0 ? ' is-up' : ' is-down');

const PositionsPanel = ({ positions, currency, symbol, onClose }: Props) => {
    const [thisMarket, setThisMarket] = useState(false);
    const [showClosed, setShowClosed] = useState(false);

    const open = useMemo(() => positions.filter(p => !p.closed), [positions]);
    const closed = useMemo(() => positions.filter(p => p.closed).slice(0, 15), [positions]);
    const shown = thisMarket ? open.filter(p => p.symbol === symbol) : open;
    const sum = useMemo(() => summarize(shown), [shown]);

    const close = (filter: CloseFilter) => onClose(pickToClose(open, filter, thisMarket ? symbol : undefined));

    return (
        <section className='forex-live__card forex-live__positions'>
            <header className='forex-live__card-head'>
                <h3>Open trades</h3>
                <label className='forex-live__switch'>
                    <input type='checkbox' checked={thisMarket} onChange={e => setThisMarket(e.target.checked)} />
                    <span>This market only</span>
                </label>
            </header>

            <div className='forex-live__summary'>
                <div>
                    <small>Open</small>
                    <b>{sum.open}</b>
                    <em>
                        ▲{sum.buys} ▼{sum.sells}
                    </em>
                </div>
                <div>
                    <small>Total stake</small>
                    <b>{sum.stake.toFixed(2)}</b>
                    <em>{currency}</em>
                </div>
                <div className={`forex-live__pl${sign(sum.profit)}`}>
                    <small>Profit / loss</small>
                    <b>{formatMoney(sum.profit)}</b>
                    <em>{currency}</em>
                </div>
            </div>

            <div className='forex-live__closebar'>
                <button type='button' className='is-main' disabled={!sum.open} onClick={() => close('all')}>
                    Close all
                </button>
                <button type='button' disabled={!sum.buys} onClick={() => close('buy')}>
                    Buys
                </button>
                <button type='button' disabled={!sum.sells} onClick={() => close('sell')}>
                    Sells
                </button>
                <button type='button' disabled={!sum.winning} onClick={() => close('winning')}>
                    Winners
                </button>
                <button type='button' disabled={!sum.losing} onClick={() => close('losing')}>
                    Losers
                </button>
            </div>

            {shown.length === 0 ? (
                <p className='forex-live__empty'>No open trades. Press BUY or SELL to open one.</p>
            ) : (
                <ul className='forex-live__list'>
                    {shown.map(p => (
                        <li key={p.id} className={`forex-live__row forex-live__row--${p.side.toLowerCase()}`}>
                            <span className='forex-live__side'>{p.side === 'BUY' ? '▲ BUY' : '▼ SELL'}</span>
                            <span className='forex-live__sym'>
                                {p.symbol.replace(/^frx/, '')}
                                <small>
                                    {p.stake.toFixed(2)} · x{p.multiplier ?? '?'}
                                </small>
                            </span>
                            <span className={`forex-live__rowpl${sign(p.profit)}`}>{formatMoney(p.profit)}</span>
                            <button type='button' disabled={!p.canClose} onClick={() => onClose([p])}>
                                Close
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {closed.length > 0 && (
                <>
                    <button type='button' className='forex-live__toggle' onClick={() => setShowClosed(v => !v)}>
                        {showClosed ? '▾' : '▸'} Closed this session ({closed.length})
                    </button>
                    {showClosed && (
                        <ul className='forex-live__list forex-live__list--closed'>
                            {closed.map(p => (
                                <li key={p.id} className='forex-live__row'>
                                    <span className='forex-live__side'>{p.side === 'BUY' ? '▲ BUY' : '▼ SELL'}</span>
                                    <span className='forex-live__sym'>
                                        {p.symbol.replace(/^frx/, '')}
                                        <small>{p.stake.toFixed(2)}</small>
                                    </span>
                                    <span className={`forex-live__rowpl${sign(p.result)}`}>{formatMoney(p.result)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </section>
    );
};

export default PositionsPanel;
