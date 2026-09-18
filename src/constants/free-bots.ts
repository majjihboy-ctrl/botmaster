export type TFreeBot = {
    id: string;
    title: string;
    description: string;
    // When true, the 'Load' action on the Free Bots tab skips the manual
    // Run step entirely — loads the strategy into Bot Builder and starts
    // it running immediately, instead of just navigating there.
    auto_run?: boolean;
    /** Highlight card with a gold treatment in the Free Bots grid */
    golden?: boolean;
};

// Each `id` must match a file name (without extension) in `src/xml/free-bots/`.
export const FREE_BOTS: TFreeBot[] = [
    {
        id: 'sifuna-v1',
        title: 'Sifuna v1',
        description: '',
        golden: true,
    },
    {
        id: 'over-destroyer',
        title: 'Over Destroyer',
        description: '',
    },
    {
        id: 'kuomoka-digit-under',
        title: 'Kuomoka Digit Under',
        description: '',
    },
    {
        id: 'differ-killer-bot',
        title: 'Differ Killer Bot',
        description: '',
    },
    {
        id: 'over-2-under-7-master-bot',
        title: 'Over 2 / Under 7 Master Bot',
        description: '',
    },
    {
        id: 'over-1-entry-search-after-loss',
        title: 'Over 1 – Entry Search After Loss',
        description: '',
    },
    {
        id: 'last-digit-martingale',
        title: 'Last Digit Bot with Martingale',
        description: '',
    },
    {
        id: 'savior-bot',
        title: 'Savior Bot',
        description: '',
    },
    {
        id: 'kichele-v1-9',
        title: 'Kichele V1.9',
        description: '',
    },
    {
        id: 'fable-v1-pro',
        title: 'Fable V1 Pro',
        description: '',
    },
    {
        id: 'even-odd-v2',
        title: 'Even/Odd V2',
        description: '',
        auto_run: true,
    },
    {
        id: 'digitpulse-pro',
        title: 'DigitPulse Pro',
        description: '',
    },
    {
        id: 'over-under-v2',
        title: 'Over/Under V2',
        description: '',
        auto_run: true,
    },
];
