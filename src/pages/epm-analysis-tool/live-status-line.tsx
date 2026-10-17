import { localize } from '@deriv-com/translations';
import { useEpmTickSnapshot, type EpmTickStore } from './use-epm-tick-stats';

interface LiveStatusLineProps {
    store: EpmTickStore;
    symbol: string;
}

/**
 * "<symbol> — N ticks buffered" / "Connecting…" / error line. Subscribes to
 * the tick store directly (updates every tick) so only this small line
 * redraws, not the whole page -- see use-epm-tick-stats.ts.
 */
function LiveStatusLine({ store, symbol }: LiveStatusLineProps) {
    const { ticks, status, errorMessage } = useEpmTickSnapshot(store);

    return (
        <div className='epm-analysis-tool__status'>
            <span
                className={`epm-analysis-tool__dot epm-analysis-tool__dot--${
                    status === 'analyzing' ? 'live' : status === 'error' ? 'off' : 'idle'
                }`}
            />
            <span>
                {status === 'analyzing' && `${symbol} — ${ticks.length} ${localize('ticks buffered')}`}
                {status === 'connecting' && localize('Connecting…')}
                {status === 'error' && (errorMessage || localize('Connection error'))}
            </span>
        </div>
    );
}

export default LiveStatusLine;
