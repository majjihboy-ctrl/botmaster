export type StrategyId = number;

export interface StrategyInfo {
    id: StrategyId;
    name: string;
    category: string;
    ready: boolean;
}

/** Every strategy planned for the Forex Trader tool, numbered as agreed.
 *  `ready: true` = fully working; the rest show as "Coming soon" in the picker
 *  and get built one by one. */
export const STRATEGIES: StrategyInfo[] = [
    { id: 1, name: 'Asian High/Low sweep', category: 'Liquidity sweeps and breakouts', ready: true },
    { id: 2, name: 'Previous day high/low sweep', category: 'Liquidity sweeps and breakouts', ready: true },
    { id: 3, name: 'Previous week high/low sweep', category: 'Liquidity sweeps and breakouts', ready: true },
    { id: 4, name: 'London session high/low sweep', category: 'Liquidity sweeps and breakouts', ready: true },
    { id: 5, name: 'New York session high/low sweep', category: 'Liquidity sweeps and breakouts', ready: true },
    { id: 6, name: 'Equal highs/lows grab', category: 'Liquidity sweeps and breakouts', ready: false },
    { id: 7, name: 'Opening range breakout', category: 'Liquidity sweeps and breakouts', ready: false },
    { id: 8, name: 'Fake breakout', category: 'Liquidity sweeps and breakouts', ready: false },
    { id: 9, name: 'Order blocks', category: 'Smart-money concepts (ICT)', ready: false },
    { id: 10, name: 'Fair value gaps', category: 'Smart-money concepts (ICT)', ready: false },
    { id: 11, name: 'Break of structure / change of character', category: 'Smart-money concepts (ICT)', ready: false },
    { id: 12, name: 'Premium and discount zones', category: 'Smart-money concepts (ICT)', ready: false },
    { id: 13, name: 'Support and resistance bounce', category: 'Classic price action', ready: false },
    { id: 14, name: 'Breakout and retest', category: 'Classic price action', ready: false },
    { id: 15, name: 'Trendline break', category: 'Classic price action', ready: false },
    { id: 16, name: 'Double top / double bottom', category: 'Classic price action', ready: false },
    { id: 17, name: 'Head and shoulders', category: 'Classic price action', ready: false },
    { id: 18, name: 'Flags and triangles', category: 'Classic price action', ready: false },
    { id: 19, name: 'Engulfing candles', category: 'Classic price action', ready: false },
    { id: 20, name: 'Pin bars (rejection wicks)', category: 'Classic price action', ready: false },
    { id: 21, name: 'Fibonacci retracement (50%–61.8%)', category: 'Classic price action', ready: false },
    { id: 22, name: 'Moving average cross', category: 'Indicator-based', ready: false },
    { id: 23, name: 'RSI overbought/oversold', category: 'Indicator-based', ready: false },
    { id: 24, name: 'MACD', category: 'Indicator-based', ready: false },
    { id: 25, name: 'Bollinger Bands', category: 'Indicator-based', ready: false },
    { id: 26, name: 'VWAP', category: 'Indicator-based', ready: false },
    { id: 27, name: 'Supertrend', category: 'Indicator-based', ready: false },
    { id: 28, name: 'Ichimoku', category: 'Indicator-based', ready: false },
    { id: 29, name: 'Pivot points', category: 'Indicator-based', ready: false },
    { id: 30, name: 'Supply and demand zones', category: 'Other', ready: false },
    { id: 31, name: 'Wyckoff accumulation / distribution', category: 'Other', ready: false },
    { id: 32, name: 'Boom/Crash spike trading (Deriv only)', category: 'Other', ready: false },
    { id: 33, name: 'Range / mean-reversion on Volatility indices (Deriv only)', category: 'Other', ready: false },
];

export const STRATEGY_CATEGORIES: string[] = Array.from(new Set(STRATEGIES.map(s => s.category)));
