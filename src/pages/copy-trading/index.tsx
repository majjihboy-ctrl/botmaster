import React from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import { useCopyTrading } from './use-copy-trading';
import './copy-trading.scss';

const humanizeKey = (key: string) =>
    key
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

// Deriv's copy_list / copytrading_statistics responses can carry fields we
// don't have a fully confirmed schema for — rather than hard-code field
// names and risk silently dropping data (or showing blanks) if a guess is
// wrong, render whatever comes back, adaptively, with humanized labels.
const AdaptiveView: React.FC<{ data: any; depth?: number }> = ({ data, depth = 0 }) => {
    if (data === null || data === undefined) {
        return <span className='copy-trading__empty-value'>—</span>;
    }
    if (Array.isArray(data)) {
        if (data.length === 0) return <span className='copy-trading__empty-value'>—</span>;
        return (
            <div className='copy-trading__adaptive-list'>
                {data.map((item, i) => (
                    <div key={i} className='copy-trading__adaptive-list-item'>
                        <AdaptiveView data={item} depth={depth + 1} />
                    </div>
                ))}
            </div>
        );
    }
    if (typeof data === 'object') {
        const entries = Object.entries(data);
        if (entries.length === 0) return <span className='copy-trading__empty-value'>—</span>;
        return (
            <div className='copy-trading__adaptive-object'>
                {entries.map(([key, value]) => (
                    <div key={key} className='copy-trading__adaptive-row'>
                        <span className='copy-trading__adaptive-key'>{humanizeKey(key)}</span>
                        <span className='copy-trading__adaptive-value'>
                            {typeof value === 'object' && value !== null ? (
                                <AdaptiveView data={value} depth={depth + 1} />
                            ) : (
                                String(value)
                            )}
                        </span>
                    </div>
                ))}
            </div>
        );
    }
    return <span>{String(data)}</span>;
};

const CopyTrading = observer(() => {
    const { remembered, copy_list, list_loading, list_error, refreshList, startCopying, stopCopying, lookupStatistics } =
        useCopyTrading();

    const [nickname, setNickname] = React.useState('');
    const [token, setToken] = React.useState('');
    const [assets_text, setAssetsText] = React.useState('');
    const [trade_types_text, setTradeTypesText] = React.useState('');
    const [min_stake, setMinStake] = React.useState('');
    const [max_stake, setMaxStake] = React.useState('');
    const [start_status, setStartStatus] = React.useState<{ kind: 'idle' | 'loading' | 'success' | 'error'; message: string }>({
        kind: 'idle',
        message: '',
    });

    const [trader_id, setTraderId] = React.useState('');
    const [stats, setStats] = React.useState<any>(null);
    const [stats_status, setStatsStatus] = React.useState<{ kind: 'idle' | 'loading' | 'success' | 'error'; message: string }>({
        kind: 'idle',
        message: '',
    });

    const [stopping_token, setStoppingToken] = React.useState<string | null>(null);

    const handleStart = async () => {
        if (!token.trim()) {
            setStartStatus({ kind: 'error', message: localize("Paste the trader's API token first.") });
            return;
        }
        setStartStatus({ kind: 'loading', message: '' });
        const result = await startCopying({
            token: token.trim(),
            nickname: nickname.trim(),
            assets: assets_text
                .split(',')
                .map(s => s.trim())
                .filter(Boolean),
            trade_types: trade_types_text
                .split(',')
                .map(s => s.trim())
                .filter(Boolean),
            min_trade_stake: min_stake ? Number(min_stake) : undefined,
            max_trade_stake: max_stake ? Number(max_stake) : undefined,
        });
        setStartStatus({ kind: result.success ? 'success' : 'error', message: result.message });
        if (result.success) {
            setNickname('');
            setToken('');
            setAssetsText('');
            setTradeTypesText('');
            setMinStake('');
            setMaxStake('');
        }
    };

    const handleStop = async (t: string) => {
        setStoppingToken(t);
        await stopCopying(t);
        setStoppingToken(null);
    };

    const handleLookup = async () => {
        if (!trader_id.trim()) return;
        setStatsStatus({ kind: 'loading', message: '' });
        setStats(null);
        const result = await lookupStatistics(trader_id.trim());
        if (result.success) {
            setStats(result.data);
            setStatsStatus({ kind: 'success', message: '' });
        } else {
            setStatsStatus({ kind: 'error', message: result.message });
        }
    };

    return (
        <div className='copy-trading'>
            <div className='copy-trading__topbar'>
                <div className='copy-trading__title'>
                    <h1>{localize('Copy Trading')}</h1>
                </div>
                <p className='copy-trading__field-hint'>
                    {localize(
                        "Copy another trader's real trades automatically, or let others copy yours. Deriv requires the trader's own API token to start — there's no public trader directory in the API, so you'll need to get it from them directly."
                    )}
                </p>
            </div>

            <div className='copy-trading__grid'>
                <div className='copy-trading__col-main'>
                    <div className='copy-trading__panel'>
                        <h2>{localize('Start copying a trader')}</h2>

                        <div className='copy-trading__field-group'>
                            <label className='copy-trading__field-label' htmlFor='ct-nickname'>
                                {localize('Nickname (for your reference only)')}
                            </label>
                            <input
                                id='ct-nickname'
                                type='text'
                                value={nickname}
                                onChange={e => setNickname(e.target.value)}
                                placeholder={localize('e.g. Jake — Volatility scalper')}
                            />
                        </div>

                        <div className='copy-trading__field-group'>
                            <label className='copy-trading__field-label' htmlFor='ct-token'>
                                {localize("Trader's API token")}
                            </label>
                            <input
                                id='ct-token'
                                type='password'
                                autoComplete='off'
                                value={token}
                                onChange={e => setToken(e.target.value)}
                                placeholder={localize('Paste the token they shared with you')}
                            />
                            <p className='copy-trading__field-hint small'>
                                {localize('Stored only in this browser, only to let you Stop copying later. Never shared anywhere else.')}
                            </p>
                        </div>

                        <div className='copy-trading__field-row'>
                            <div className='copy-trading__field-group'>
                                <label className='copy-trading__field-label' htmlFor='ct-assets'>
                                    {localize('Assets (optional)')}
                                </label>
                                <input
                                    id='ct-assets'
                                    type='text'
                                    value={assets_text}
                                    onChange={e => setAssetsText(e.target.value)}
                                    placeholder='R_50, R_100'
                                />
                            </div>
                            <div className='copy-trading__field-group'>
                                <label className='copy-trading__field-label' htmlFor='ct-trade-types'>
                                    {localize('Trade types (optional)')}
                                </label>
                                <input
                                    id='ct-trade-types'
                                    type='text'
                                    value={trade_types_text}
                                    onChange={e => setTradeTypesText(e.target.value)}
                                    placeholder='CALL, PUT'
                                />
                            </div>
                        </div>

                        <div className='copy-trading__field-row'>
                            <div className='copy-trading__field-group'>
                                <label className='copy-trading__field-label' htmlFor='ct-min-stake'>
                                    {localize('Min trade stake (optional)')}
                                </label>
                                <input
                                    id='ct-min-stake'
                                    type='number'
                                    value={min_stake}
                                    onChange={e => setMinStake(e.target.value)}
                                    placeholder='0.35'
                                />
                            </div>
                            <div className='copy-trading__field-group'>
                                <label className='copy-trading__field-label' htmlFor='ct-max-stake'>
                                    {localize('Max trade stake (optional)')}
                                </label>
                                <input
                                    id='ct-max-stake'
                                    type='number'
                                    value={max_stake}
                                    onChange={e => setMaxStake(e.target.value)}
                                    placeholder='50'
                                />
                            </div>
                        </div>

                        {start_status.kind === 'error' && <p className='copy-trading__message error'>{start_status.message}</p>}
                        {start_status.kind === 'success' && <p className='copy-trading__message success'>{start_status.message}</p>}

                        <button
                            className='copy-trading__btn primary'
                            onClick={handleStart}
                            disabled={start_status.kind === 'loading'}
                        >
                            {start_status.kind === 'loading' ? localize('Starting…') : localize('Start copying')}
                        </button>
                    </div>

                    <div className='copy-trading__panel'>
                        <h2>{localize("Look up a trader's statistics")}</h2>
                        <div className='copy-trading__field-group'>
                            <label className='copy-trading__field-label' htmlFor='ct-trader-id'>
                                {localize('Trader ID')}
                            </label>
                            <div className='copy-trading__inline-form'>
                                <input
                                    id='ct-trader-id'
                                    type='text'
                                    value={trader_id}
                                    onChange={e => setTraderId(e.target.value)}
                                    placeholder='CR123456'
                                />
                                <button
                                    className='copy-trading__btn secondary'
                                    onClick={handleLookup}
                                    disabled={stats_status.kind === 'loading'}
                                >
                                    {stats_status.kind === 'loading' ? localize('Looking up…') : localize('Look up')}
                                </button>
                            </div>
                        </div>
                        {stats_status.kind === 'error' && <p className='copy-trading__message error'>{stats_status.message}</p>}
                        {stats_status.kind === 'success' && (
                            <div className='copy-trading__stats-result'>
                                <AdaptiveView data={stats} />
                            </div>
                        )}
                    </div>
                </div>

                <div className='copy-trading__col-side'>
                    <div className='copy-trading__panel'>
                        <h2>
                            {localize('Currently copying')} ({remembered.length})
                        </h2>
                        {remembered.length === 0 ? (
                            <div className='copy-trading__empty-state'>{localize('Not copying anyone yet.')}</div>
                        ) : (
                            <div className='copy-trading__remembered-list'>
                                {remembered.map(r => (
                                    <div key={r.token} className='copy-trading__remembered-item'>
                                        <div className='copy-trading__remembered-info'>
                                            <span className='name'>{r.nickname}</span>
                                            <span className='date'>
                                                {localize('Since')} {new Date(r.started_at).toLocaleDateString()}
                                            </span>
                                        </div>
                                        <button
                                            className='copy-trading__btn danger small'
                                            onClick={() => handleStop(r.token)}
                                            disabled={stopping_token === r.token}
                                        >
                                            {stopping_token === r.token ? localize('Stopping…') : localize('Stop')}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className='copy-trading__panel'>
                        <h2>
                            {localize('Copy trading list')}
                            <button className='copy-trading__refresh-btn' onClick={refreshList} title={localize('Refresh')}>
                                ↻
                            </button>
                        </h2>
                        {list_loading && <div className='copy-trading__empty-state'>{localize('Loading…')}</div>}
                        {list_error && <p className='copy-trading__message error'>{list_error}</p>}
                        {!list_loading && !list_error && (
                            <div className='copy-trading__list-result'>
                                <AdaptiveView data={copy_list} />
                            </div>
                        )}
                        <p className='copy-trading__field-hint small'>
                            {localize('Shows everyone copying you and everyone you copy, as returned directly by Deriv.')}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default CopyTrading;
