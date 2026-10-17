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
    {
        id: 'double-differs-exclude-red-green',
        title: 'Double Differs Exclude Red and Green',
        description: '',
    },
    {
        id: '2-prediction-ou-m7-bot',
        title: '2 Prediction O&U M7 Bot',
        description: '',
    },
    {
        id: 'ak-entry-point-software-003',
        title: 'AK Entry Point Software 003',
        description: '',
    },
    {
        id: 'alpha-system-001',
        title: 'Alpha System 001',
        description: '',
    },
    {
        id: 'digit-flux-by-kim',
        title: 'Digit Flux by Kim',
        description: '',
    },
    {
        id: 'dollar-guard-s1',
        title: 'Dollar Guard S1',
        description: '',
    },
    {
        id: 'genesis-version-1-by-kim',
        title: 'Genesis Version 1 by Kim',
        description: '',
    },
    {
        id: 'millern-even-odd',
        title: 'Millern Even Odd',
        description: '',
    },
    {
        id: 'millern-sv7',
        title: 'Millern SV7',
        description: '',
    },
    {
        id: 'millern-v2',
        title: 'Millern V2',
        description: '',
    },
    {
        id: 'money-gram-v1-auto',
        title: 'Money Gram V1 Auto',
        description: '',
    },
    {
        id: 'over-1-bot-with-over-3-recovery',
        title: 'Over 1 Bot with Over 3 Recovery',
        description: '',
    },
    {
        id: 'pesa-flip-g1',
        title: 'Pesa Flip G1',
        description: '',
    },
    {
        id: 'pesa-flow-s3',
        title: 'Pesa Flow S3',
        description: '',
    },
    {
        id: 'xenon-rv1',
        title: 'Xenon RV1',
        description: '',
    },
    {
        id: 'pulse-even-odd',
        title: 'Even Odd',
        description: '',
    },
];
