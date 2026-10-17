// Public Deriv WebSocket endpoint used by the Forex Trader market data feed.
type DerivEnv = 'production' | 'preview';

const PUBLIC_WS: Record<DerivEnv, string> = {
    production: 'wss://api.derivws.com/trading/v1/options/ws/public',
    preview: 'wss://staging-api.derivws.com/trading/v1/options/ws/public',
};

export function getPublicWsUrl(): string {
    const env: DerivEnv = process.env.NEXT_PUBLIC_DERIV_ENV === 'preview' ? 'preview' : 'production';
    return PUBLIC_WS[env];
}
