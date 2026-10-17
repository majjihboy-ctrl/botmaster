import type { MtfResult } from './mtf';

interface Props {
    result: MtfResult | null;
    market: string;
    /** Formats a price with the market's number of decimals. */
    fmt: (n: number) => string;
    loading: boolean;
    error: string | null;
    marketClosed: boolean;
}

const gmt = (t: number) => {
    const d = new Date(t * 1000);
    return `${d.toUTCString().slice(5, 11)} ${d.toISOString().slice(11, 16)} GMT`;
};

const BIAS_TEXT = { bullish: 'Bullish (looking for BUY)', bearish: 'Bearish (looking for SELL)', unclear: 'Unclear (no trade)' } as const;
const M5_TEXT = { confirmed: 'Confirmed', waiting: 'Not confirmed yet', against: 'Against M15', stale: 'Entry has passed', no_data: 'No data' } as const;

/** Result of the "M15 analysis + M5 entry" mode. It only shows what the calculation found; it never invents a signal. */
const MtfPanel = ({ result, market, fmt, loading, error, marketClosed }: Props) => {
    if (error) return <p className='forex-trader__warn'>⚠ {error}. No signal: the candle data could not be loaded.</p>;
    if (marketClosed) return <p className='forex-trader__hint'>Market closed, so there is no live analysis. WAIT / NO SIGNAL.</p>;
    if (loading || !result) return <p className='forex-trader__hint'>Loading the M15 and M5 candles…</p>;

    const tone = result.signal === 'BUY' ? 'buy' : result.signal === 'SELL' ? 'sell' : 'wait';
    const lv = result.levels;
    const plan = result.plan;
    return (
        <>
            <div className='forex-trader__result-head'>
                <span className={`forex-trader__pill forex-trader__pill--${tone}`}>
                    {result.signal === 'WAIT' ? 'WAIT / NO SIGNAL' : `${result.signal} signal: entry confirmed`}
                </span>
            </div>
            <p className='forex-trader__code-status'>
                {result.signal === 'WAIT'
                    ? 'The conditions are not all met, so there is no trade right now. This page keeps checking and changes by itself when they are.'
                    : 'All conditions are met on closed candles. This is the moment the setup is ready.'}
            </p>

            <h4 className='forex-trader__h'>Signal</h4>
            <dl className='forex-trader__facts'>
                <dt>Instrument</dt>
                <dd>{market}</dd>
                <dt>M15 market direction</dt>
                <dd>{BIAS_TEXT[result.bias]}</dd>
                <dt>M5 entry confirmation</dt>
                <dd>{M5_TEXT[result.m5Status]}</dd>
                <dt>Signal</dt>
                <dd>
                    <b>{result.signal}</b>
                </dd>
                {result.signalTime && (
                    <>
                        <dt>Signal time</dt>
                        <dd>
                            {gmt(result.signalTime)} {result.signal === 'WAIT' ? '(last closed M5 candle)' : '(close of the confirming M5 candle)'}
                        </dd>
                    </>
                )}
                {result.lastPrice !== null && (
                    <>
                        <dt>Price now</dt>
                        <dd>{fmt(result.lastPrice)}</dd>
                    </>
                )}
            </dl>

            {plan && (
                <>
                    <h4 className='forex-trader__h'>Trade plan ({plan.side})</h4>
                    <div className='forex-trader__grid'>
                        <div className='is-entry'>
                            <span>Entry (last closed M5 candle)</span>
                            <b>{fmt(plan.entry)}</b>
                        </div>
                        <div className='is-sl'>
                            <span>Stop loss</span>
                            <b>{fmt(plan.stopLoss)}</b>
                        </div>
                        <div className='is-tp'>
                            <span>Take profit</span>
                            <b>{fmt(plan.takeProfit)}</b>
                        </div>
                        <div>
                            <span>Risk : Reward</span>
                            <b>1 : {plan.rr.toFixed(2)}</b>
                        </div>
                    </div>
                </>
            )}

            <h4 className='forex-trader__h'>Why</h4>
            <ul className='forex-trader__check'>
                {result.reasons.map((r, i) => (
                    <li key={i} className={result.signal === 'WAIT' && i === result.reasons.length - 1 ? 'is-wait' : 'is-yes'}>
                        <span>{result.signal === 'WAIT' && i === result.reasons.length - 1 ? '○' : '✔'}</span> {r}
                    </li>
                ))}
            </ul>

            <h4 className='forex-trader__h'>M15 levels</h4>
            <dl className='forex-trader__facts'>
                <dt>Resistance</dt>
                <dd>{lv.resistance !== null ? fmt(lv.resistance) : 'none found above price'}</dd>
                <dt>Support</dt>
                <dd>{lv.support !== null ? fmt(lv.support) : 'none found below price'}</dd>
                {lv.invalidation !== null && (
                    <>
                        <dt>Direction breaks at</dt>
                        <dd>{fmt(lv.invalidation)}</dd>
                    </>
                )}
                {lv.prevDayHigh !== null && lv.prevDayLow !== null && (
                    <>
                        <dt>Previous day</dt>
                        <dd>
                            High {fmt(lv.prevDayHigh)} · Low {fmt(lv.prevDayLow)}
                        </dd>
                    </>
                )}
                {lv.equalHighs !== null && (
                    <>
                        <dt>Equal highs (liquidity above)</dt>
                        <dd>{fmt(lv.equalHighs)}</dd>
                    </>
                )}
                {lv.equalLows !== null && (
                    <>
                        <dt>Equal lows (liquidity below)</dt>
                        <dd>{fmt(lv.equalLows)}</dd>
                    </>
                )}
            </dl>
            <p className='forex-trader__muted'>
                Uses real M15 and M5 candles from Deriv, closed candles only. Signals only: no strategy wins every time, and nothing here is a guarantee.
            </p>
        </>
    );
};

export default MtfPanel;
