import { useEffect, useState } from 'react';
import type { Side, TradeInput } from './trade-engine';

interface Props {
    symbol: string;
    currency: string;
    multipliers: number[];
    /** Not signed in yet / not connected: the buttons stay visible but do nothing. */
    disabled: boolean;
    /** How many requests are on their way to Deriv right now. */
    pending: number;
    onTrade: (trades: TradeInput[]) => void;
}

const PREFS_KEY = 'epm_forex_live_prefs';
const STAKES = [1, 5, 10, 25, 50];
const COUNTS = [1, 2, 3, 5, 10];

interface Prefs {
    stake: string;
    multiplier: number;
    stopLoss: string;
    takeProfit: string;
    count: number;
}

const DEFAULTS: Prefs = { stake: '1', multiplier: 100, stopLoss: '', takeProfit: '', count: 1 };

const loadPrefs = (): Prefs => {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
        /* private mode or blocked storage: start from the defaults */
    }
    return DEFAULTS;
};

const nearest = (list: number[], want: number): number =>
    list.length ? list.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a)) : want;

const TradePanel = ({ symbol, currency, multipliers, disabled, pending, onTrade }: Props) => {
    const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
    const set = (patch: Partial<Prefs>) => setPrefs(p => ({ ...p, ...patch }));

    useEffect(() => {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
        } catch {
            /* ignore */
        }
    }, [prefs]);

    // a market with different allowed multipliers: move to the closest one
    useEffect(() => {
        if (multipliers.length && !multipliers.includes(prefs.multiplier)) set({ multiplier: nearest(multipliers, prefs.multiplier) });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [multipliers]);

    const fire = (side: Side) => {
        if (disabled) return;
        const trade: TradeInput = {
            side,
            symbol,
            currency,
            stake: Number(prefs.stake),
            multiplier: prefs.multiplier,
            stopLoss: prefs.stopLoss.trim() ? Number(prefs.stopLoss) : null,
            takeProfit: prefs.takeProfit.trim() ? Number(prefs.takeProfit) : null,
        };
        // every click is sent straight away; "trades per click" opens several at the same moment
        onTrade(Array.from({ length: prefs.count }, () => trade));
    };

    const name = symbol.replace(/^frx/, '');

    return (
        <section className='forex-live__card forex-live__trade'>
            <header className='forex-live__card-head'>
                <h3>Trade {name}</h3>
                {pending > 0 && <span className='forex-live__sending'>sending {pending}…</span>}
            </header>

            <div className='forex-live__buttons'>
                <button type='button' className='forex-live__go forex-live__go--buy' disabled={disabled} onClick={() => fire('BUY')}>
                    BUY <span>▲</span>
                    {prefs.count > 1 && <small>×{prefs.count}</small>}
                </button>
                <button type='button' className='forex-live__go forex-live__go--sell' disabled={disabled} onClick={() => fire('SELL')}>
                    SELL <span>▼</span>
                    {prefs.count > 1 && <small>×{prefs.count}</small>}
                </button>
            </div>

            <div className='forex-live__grid'>
                <label>
                    <span>Stake ({currency || '…'})</span>
                    <input
                        type='number'
                        min='0'
                        step='any'
                        inputMode='decimal'
                        value={prefs.stake}
                        onChange={e => set({ stake: e.target.value })}
                    />
                </label>
                <label>
                    <span>Multiplier</span>
                    <select value={prefs.multiplier} onChange={e => set({ multiplier: Number(e.target.value) })}>
                        {(multipliers.includes(prefs.multiplier) ? multipliers : [...multipliers, prefs.multiplier].sort((a, b) => a - b)).map(m => (
                            <option key={m} value={m}>
                                x{m}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>Stop loss ({currency || '…'})</span>
                    <input
                        type='number'
                        min='0'
                        step='any'
                        inputMode='decimal'
                        placeholder='none'
                        value={prefs.stopLoss}
                        onChange={e => set({ stopLoss: e.target.value })}
                    />
                </label>
                <label>
                    <span>Take profit ({currency || '…'})</span>
                    <input
                        type='number'
                        min='0'
                        step='any'
                        inputMode='decimal'
                        placeholder='none'
                        value={prefs.takeProfit}
                        onChange={e => set({ takeProfit: e.target.value })}
                    />
                </label>
            </div>

            <div className='forex-live__chips' aria-label='Quick stakes'>
                {STAKES.map(s => (
                    <button key={s} type='button' className={Number(prefs.stake) === s ? 'is-on' : ''} onClick={() => set({ stake: String(s) })}>
                        {s}
                    </button>
                ))}
                <label className='forex-live__count'>
                    <span>Trades per click</span>
                    <select value={prefs.count} onChange={e => set({ count: Number(e.target.value) })}>
                        {COUNTS.map(c => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            <p className='forex-live__hint'>
                No time limit: a trade stays open until you close it, or until its stop loss / take profit is reached. You can never lose more than the stake.
            </p>
        </section>
    );
};

export default TradePanel;
