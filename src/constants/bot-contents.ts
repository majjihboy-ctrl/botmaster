type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 0,
    BOT_BUILDER: 1,
    CHART: 2,
    FREE_BOTS: 3,
    ANALYSIS_TOOL: 4,
    UPS_DOWNS_TOOL: 5,
    SPEED_TRADER: 6,
    RNG_ANALYZER: 7,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    'id-dbot-dashboard',
    'id-bot-builder',
    'id-charts',
    'id-free-bots',
    'id-analysis-tool',
    'id-ups-downs-tool',
    'id-speed-trader',
    'id-rng-analyzer',
];

export const DEBOUNCE_INTERVAL_TIME = 500;
