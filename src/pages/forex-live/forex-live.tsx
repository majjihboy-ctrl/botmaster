import { useCallback, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { isDemoAccount } from '@/utils/account-helpers';
import ForexTrader, { type ReportedPlan } from '../forex-trader/forex-trader';
import LiveChart, { type ChartLine } from './live-chart';
import PositionsPanel from './positions-panel';
import { DEFAULT_GRANULARITY, DEFAULT_SYMBOL, type TradeInput } from './trade-engine';
import TradePanel from './trade-panel';
import { useForexLive, useMultipliers } from './use-forex-live';
import './forex-live.scss';

const DEMO_FLAG = 'epm_forex_live_demo_default';

/**
 * Forex Live: trade forex with no fixed time. Every trade is a Deriv multiplier, so it stays open until you
 * close it. One click opens a trade straight away (no confirmation step, because the price moves while you
 * confirm), and as many can be open together as you like, buys and sells at the same time.
 * The chart is Deriv's SmartCharts on forex, 15-minute candles, with the Forex Trader analysis beside it.
 */
const ForexLive = observer(() => {
    const { client, run_panel } = useStore();
    const { isAuthorized, accountList, activeLoginid, authData } = useApiBase();

    const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
    const [granularity, setGranularity] = useState(DEFAULT_GRANULARITY);
    const [chartType, setChartType] = useState('candle');
    const [plan, setPlan] = useState<{ plan: ReportedPlan | null; symbol: string }>({ plan: null, symbol: '' });
    const [notice, setNotice] = useState('');

    const currency = client?.currency || (authData as any)?.currency || '';
    const balance = client?.balance ?? (authData as any)?.balance;
    const demo = !!activeLoginid && isDemoAccount(activeLoginid);
    const demoAccount = accountList?.find(a => isDemoAccount(a.loginid));
    const botRunning = !!(run_panel?.is_running || api_base.is_running);

    const { positions, log, pending, openTrade, closeTrades } = useForexLive(isAuthorized, activeLoginid);
    const multipliers = useMultipliers(symbol, isAuthorized);

    const switchToDemo = useCallback(() => {
        if (!demoAccount || botRunning) return;
        localStorage.setItem('active_loginid', demoAccount.loginid);
        client?.checkAndRegenerateWebSocket();
    }, [demoAccount, botRunning, client]);

    // Opens on the Demo account the first time, so nobody trades real money by accident. After that the choice is theirs.
    useEffect(() => {
        if (!isAuthorized || !activeLoginid) return;
        let seen = false;
        try {
            seen = !!localStorage.getItem(DEMO_FLAG);
            if (!seen) localStorage.setItem(DEMO_FLAG, '1');
        } catch {
            return;
        }
        if (seen || demo || !demoAccount || botRunning) return;
        setNotice('Opened on your Demo account. Use the account menu at the top whenever you want to trade Real.');
        switchToDemo();
    }, [isAuthorized, activeLoginid, demo, demoAccount, botRunning, switchToDemo]);

    const trade = useCallback((list: TradeInput[]) => {
        // all sent at once; nothing waits for anything else
        list.forEach(t => void openTrade(t));
    }, [openTrade]);

    const lines: ChartLine[] = useMemo(() => {
        const p = plan.symbol === symbol ? plan.plan : null;
        if (!p) return [];
        return [
            { key: 'entry', title: 'Entry', price: p.entry, color: '#3B82F6' },
            { key: 'sl', title: 'Stop loss', price: p.stopLoss, color: '#ef4444' },
            { key: 'tp', title: 'Take profit', price: p.takeProfit, color: '#10b981' },
        ];
    }, [plan, symbol]);

    const onPlan = useCallback((p: ReportedPlan | null, s: string) => setPlan({ plan: p, symbol: s }), []);

    return (
        <div className='forex-live'>
            <div className='forex-live__chartcol'>
                <LiveChart
                    symbol={symbol}
                    granularity={granularity}
                    chartType={chartType}
                    lines={lines}
                    onSymbol={setSymbol}
                    onGranularity={setGranularity}
                    onChartType={setChartType}
                />
                {lines.length > 0 && (
                    <div className='forex-live__legend'>
                        <span style={{ color: '#3B82F6' }}>— Entry</span>
                        <span style={{ color: '#ef4444' }}>— Stop loss</span>
                        <span style={{ color: '#10b981' }}>— Take profit</span>
                        <em>from the analysis</em>
                    </div>
                )}
            </div>

            <aside className='forex-live__side'>
                <section className={`forex-live__account${demo ? ' is-demo' : ' is-real'}`}>
                    {isAuthorized ? (
                        <>
                            <span className='forex-live__badge'>{demo ? 'DEMO' : 'REAL MONEY'}</span>
                            <b>
                                {balance !== undefined && balance !== null && balance !== '' ? Number(balance).toFixed(2) : '—'} {currency}
                            </b>
                            {!demo && demoAccount && (
                                <button type='button' disabled={botRunning} onClick={switchToDemo} title={botRunning ? 'Stop the running bot first' : ''}>
                                    Switch to Demo
                                </button>
                            )}
                        </>
                    ) : (
                        <span>Log in at the top right to start trading.</span>
                    )}
                </section>
                {notice && (
                    <p className='forex-live__notice' role='status' onClick={() => setNotice('')}>
                        {notice}
                    </p>
                )}

                <TradePanel
                    symbol={symbol}
                    currency={currency}
                    multipliers={multipliers}
                    disabled={!isAuthorized}
                    pending={pending}
                    onTrade={trade}
                />

                <PositionsPanel positions={positions} currency={currency} symbol={symbol} onClose={list => void closeTrades(list)} />

                {log.length > 0 && (
                    <section className='forex-live__card forex-live__log' aria-live='polite'>
                        <header className='forex-live__card-head'>
                            <h3>Activity</h3>
                        </header>
                        <ul>
                            {log.slice(0, 8).map(l => (
                                <li key={l.id} className={`is-${l.kind}`}>
                                    {l.text}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <details className='forex-live__card forex-live__analysis' open>
                    <summary>Market analysis (same as Forex Trader)</summary>
                    <ForexTrader
                        variant='panel'
                        controlledSymbol={symbol}
                        onSymbolChange={setSymbol}
                        onPlan={onPlan}
                        initialMode='mtf'
                        hideChart
                    />
                </details>
            </aside>
        </div>
    );
});

export default ForexLive;
