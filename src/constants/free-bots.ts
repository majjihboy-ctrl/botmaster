export type TFreeBot = {
    id: string;
    title: string;
    description: string;
    // When true, the 'Load' action on the Free Bots tab skips the manual
    // Run step entirely — loads the strategy into Bot Builder and starts
    // it running immediately, instead of just navigating there.
    auto_run?: boolean;
};

// Each `id` must match a file name (without extension) in `src/xml/free-bots/`.
export const FREE_BOTS: TFreeBot[] = [
    {
        id: 'over-destroyer',
        title: 'Over Destroyer',
        description: 'Digit Over/Under strategy with martingale recovery.',
    },
    {
        id: 'kuomoka-digit-under',
        title: 'Kuomoka Digit Under',
        description: 'Digit Under strategy with martingale recovery.',
    },
    {
        id: 'differ-killer-bot',
        title: 'Differ Killer Bot',
        description: 'Fast-entry Digit Differs strategy with martingale recovery.',
    },
    {
        id: 'smartdiffers-x6',
        title: 'SmartDiffers X6',
        description: 'Six combined Digit Differs strategies in one bot, with martingale recovery.',
    },
    {
        id: 'over-2-under-7-master-bot',
        title: 'Over 2 / Under 7 Master Bot',
        description: 'Digit Over/Under strategy.',
    },
    {
        id: 'over-1-entry-search-after-loss',
        title: 'Over 1 – Entry Search After Loss',
        description: 'Digit Over strategy that searches for a fresh entry point after a loss.',
    },
    {
        id: 'last-digit-martingale',
        title: 'Last Digit Bot with Martingale',
        description: 'Digit Under strategy with martingale recovery.',
    },
    {
        id: 'savior-bot',
        title: 'Savior Bot',
        description: 'Rise & Equals strategy with martingale recovery. Engineered to recover losses fast.',
    },
    {
        id: 'kichele-v1-9',
        title: 'Kichele V1.9',
        description: 'Digit Under 8 strategy, entry-gated on a last digit of 1, with a Digit Over 3 martingale recovery arm on loss.',
    },
    {
        id: 'fable-v1-pro',
        title: 'Fable V1 Pro',
        description: 'Digit Over/Under recovery strategy with martingale.',
    },
    {
        id: 'even-odd-v2',
        title: 'Even/Odd V2',
        description:
            'Single-digit trigger: every time the chosen digit appears as the last digit, bets the reversal (Even or Odd) on the next tick. Martingale on loss, capped stop loss/take profit. Loads and starts running immediately.',
        auto_run: true,
    },
    {
        id: 'over-under-v2',
        title: 'Over/Under V2',
        description:
            'Single-digit trigger: every time the chosen digit appears as the last digit, bets the reversal (Over or Under a configurable barrier) on the next tick. Martingale on loss, capped stop loss/take profit. Loads and starts running immediately.',
        auto_run: true,
    },
];
