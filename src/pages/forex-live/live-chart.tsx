import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import ChunkLoader from '@/components/loader/chunk-loader';
import chart_api from '@/external/bot-skeleton/services/api/chart-api';
import { useSmartChartAdaptor } from '@/hooks/useSmartChartAdaptor';
import { useStore } from '@/hooks/useStore';
import ToolbarWidgets from '@/pages/chart/toolbar-widgets';
import { ChartTitle, SmartChart, TGranularity } from '@deriv-com/smartcharts-champion';
import { useDevice } from '@deriv-com/ui';
import '@deriv-com/smartcharts-champion/dist/smartcharts.css';

export interface ChartLine {
    key: string;
    title: string;
    price: number;
    color: string;
}

interface Props {
    symbol: string;
    granularity: number;
    chartType: string;
    lines: ChartLine[];
    onSymbol: (s: string) => void;
    onGranularity: (g: number) => void;
    onChartType: (t: string) => void;
}

/**
 * Deriv's SmartCharts with its own symbol / candle size / chart type, so changing them here never moves
 * the Charts tab. Opens on forex, 15-minute candles. The analysis plan (entry, stop loss, take profit)
 * is drawn on it as price lines.
 */
const LiveChart = observer(({ symbol, granularity, chartType, lines, onSymbol, onGranularity, onChartType }: Props) => {
    const { common, ui, chart_store } = useStore();
    const { chartData, getQuotes, subscribeQuotes, unsubscribeQuotes } = useSmartChartAdaptor();
    const { isDesktop, isMobile } = useDevice();

    // if the wanted symbol is not offered (for example a market that is closed for the weekend), fall back to any forex market
    useEffect(() => {
        const list = chartData.activeSymbols as any[];
        if (!list?.length) return;
        const has = (s: string) => list.some(a => (a.underlying_symbol ?? a.symbol) === s);
        if (!has(symbol)) {
            const fx = list.find(a => String(a.underlying_symbol ?? a.symbol ?? '').startsWith('frx'));
            if (fx) onSymbol(fx.underlying_symbol ?? fx.symbol);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chartData.activeSymbols]);

    if (!symbol || chartData.activeSymbols.length === 0) return <ChunkLoader message='' />;

    // same chart settings as the Charts tab (a variable, so the library's own settings type is not applied to extra keys)
    const settings = {
        assetInformation: false,
        countdown: true,
        isHighestLowestMarkerEnabled: false,
        language: common.current_language.toLowerCase(),
        position: ui.is_chart_layout_default ? 'bottom' : 'left',
        theme: ui.is_dark_mode_on ? 'dark' : 'light',
    };

    // plain price lines: no shading, not draggable, absolute prices
    const barriers = lines.map(l => ({
        color: l.color,
        shade: 'NONE_SINGLE',
        high: l.price,
        relative: false,
        draggable: false,
        hideOffscreenLine: false,
    }));

    return (
        <div className='forex-live__chart' dir='ltr'>
            <SmartChart
                id={`forex-live-${symbol}`}
                key={`forex-live-${symbol}`}
                barriers={barriers}
                showLastDigitStats={false}
                chartControlsWidgets={null}
                enabledChartFooter={false}
                toolbarWidget={() => (
                    <ToolbarWidgets
                        updateChartType={onChartType}
                        updateGranularity={onGranularity}
                        position={!isDesktop ? 'bottom' : 'top'}
                        isDesktop={isDesktop}
                    />
                )}
                chartType={chartType}
                isMobile={isMobile}
                enabledNavigationWidget={isDesktop}
                granularity={granularity as TGranularity}
                getQuotes={getQuotes}
                subscribeQuotes={subscribeQuotes}
                unsubscribeQuotes={unsubscribeQuotes}
                chartData={{ activeSymbols: chartData.activeSymbols, tradingTimes: chartData.tradingTimes }}
                settings={settings}
                symbol={symbol}
                topWidgets={() => <ChartTitle onChange={onSymbol} />}
                isConnectionOpened={!!chart_api?.api}
                getMarketsOrder={chart_store.getMarketsOrder}
                isLive
                leftMargin={80}
                drawingToolFloatingMenuPosition={isMobile ? { x: 100, y: 100 } : { x: 200, y: 200 }}
            />
        </div>
    );
});

export default LiveChart;
