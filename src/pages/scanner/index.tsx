import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useSyntheticSymbols } from '@/pages/analysis-tool/use-digit-stats';
import { localize } from '@deriv-com/translations';
import { TMarketScan, useDigitScanner } from './use-digit-scanner';
import './scanner.scss';

const TICK_OPTIONS = [50, 100, 200, 500, 1000];

type TSort = 'default' | 'even' | 'odd';

const barClass = (scan: TMarketScan, digit: number) => {
    if (!scan.sample_size) return '';
    if (digit === scan.most_idx) return 'scanner-card__bar--most';
    if (digit === scan.least_idx) return 'scanner-card__bar--least';
    return '';
};

const MarketCard = ({ scan }: { scan: TMarketScan }) => {
    const max_pct = Math.max(...scan.pcts, 1);
    const lean = scan.even_pct === scan.odd_pct ? null : scan.even_pct > scan.odd_pct ? 'even' : 'odd';

    return (
        <div className='scanner-card' data-testid={`dt_scanner_card_${scan.symbol}`}>
            <div className='scanner-card__header'>
                <span className='scanner-card__name'>{scan.display_name}</span>
                <span className='scanner-card__quote'>{scan.quote}</span>
            </div>

            <div className='scanner-card__bars' role='img' aria-label={localize('Last digit distribution')}>
                {scan.pcts.map((pct, digit) => (
                    <div key={digit} className='scanner-card__col'>
                        <span className='scanner-card__pct'>{pct.toFixed(1)}</span>
                        <div className='scanner-card__track'>
                            <div
                                className={`scanner-card__bar ${barClass(scan, digit)}`}
                                style={{ height: `${(pct / max_pct) * 100}%` }}
                            />
                        </div>
                        <span className='scanner-card__digit'>{digit}</span>
                    </div>
                ))}
            </div>

            <div className='scanner-card__eo'>
                <div className='scanner-card__eo-label'>
                    <span className={lean === 'even' ? 'is-lead' : ''}>
                        {localize('Even')} {scan.even_pct.toFixed(1)}%
                    </span>
                    <span className={lean === 'odd' ? 'is-lead' : ''}>
                        {localize('Odd')} {scan.odd_pct.toFixed(1)}%
                    </span>
                </div>
                <div className='scanner-card__eo-bar'>
                    <div className='scanner-card__eo-even' style={{ width: `${scan.even_pct}%` }} />
                </div>
            </div>

            <div className='scanner-card__last' aria-label={localize('Most recent digits')}>
                {scan.last_digits.map((d, i) => (
                    <span
                        key={`${i}-${d}`}
                        className={`scanner-card__chip ${d % 2 === 0 ? 'scanner-card__chip--even' : 'scanner-card__chip--odd'}`}
                    >
                        {d}
                    </span>
                ))}
            </div>
        </div>
    );
};

const Scanner = observer(() => {
    const symbols = useSyntheticSymbols();
    const [tick_count, setTickCount] = useState(100);
    const [sort, setSort] = useState<TSort>('default');
    const { scans, status } = useDigitScanner(symbols, tick_count);

    const sorted = useMemo(() => {
        const list = scans.slice();
        if (sort === 'even') list.sort((a, b) => b.even_pct - a.even_pct);
        if (sort === 'odd') list.sort((a, b) => b.odd_pct - a.odd_pct);
        return list;
    }, [scans, sort]);

    return (
        <div className='scanner'>
            <div className='scanner__toolbar'>
                <div className='scanner__title'>
                    <h2>{localize('Market Scanner')}</h2>
                    <p>{localize('Last-digit statistics across every synthetic market, updated live.')}</p>
                </div>
                <div className='scanner__controls'>
                    <label>
                        <span>{localize('Ticks')}</span>
                        <select
                            value={tick_count}
                            onChange={e => setTickCount(Number(e.target.value))}
                            data-testid='dt_scanner_ticks'
                        >
                            {TICK_OPTIONS.map(n => (
                                <option key={n} value={n}>
                                    {n}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        <span>{localize('Sort by')}</span>
                        <select
                            value={sort}
                            onChange={e => setSort(e.target.value as TSort)}
                            data-testid='dt_scanner_sort'
                        >
                            <option value='default'>{localize('Market order')}</option>
                            <option value='even'>{localize('Highest even %')}</option>
                            <option value='odd'>{localize('Highest odd %')}</option>
                        </select>
                    </label>
                </div>
            </div>

            {status === 'error' && (
                <div className='scanner__notice' role='alert'>
                    {localize('Could not load market data. Check your connection and reopen this tab.')}
                </div>
            )}
            {status === 'connecting' && !sorted.some(s => s.sample_size) && (
                <div className='scanner__notice'>{localize('Connecting to markets...')}</div>
            )}

            <div className='scanner__grid'>
                {sorted
                    .filter(s => s.sample_size > 0)
                    .map(scan => (
                        <MarketCard key={scan.symbol} scan={scan} />
                    ))}
            </div>

            <p className='scanner__footnote'>
                {localize(
                    'Statistics describe past ticks only. They do not predict the next digit and are not trading advice.'
                )}
            </p>
        </div>
    );
});

export default Scanner;
