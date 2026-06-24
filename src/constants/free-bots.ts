export type TFreeBot = {
    id: string;
    title: string;
    description: string;
};

// Each `id` must match a file name (without extension) in `src/xml/free-bots/`.
export const FREE_BOTS: TFreeBot[] = [
    {
        id: 'muokozi-v1',
        title: 'Muokozi V1',
        description: 'Digit Over/Under strategy with martingale recovery.',
    },
    {
        id: 'over-destroyer',
        title: 'Over Destroyer',
        description: 'Digit Over/Under strategy with martingale recovery.',
    },
    {
        id: 'over-1-entry-search-after-loss',
        title: 'Over 1 – Entry Search After Loss',
        description: 'Digit Over strategy that searches for a fresh entry point after a loss.',
    },
    {
        id: 'over-2-under-6-over-4',
        title: 'Over 2 / Under 6 / Over 4',
        description: 'Digit Over/Under strategy with martingale recovery.',
    },
    {
        id: 'realmoney',
        title: 'Real Money',
        description: 'Digit Over/Under strategy with martingale recovery.',
    },
    {
        id: 'matches-digit-alternator',
        title: 'Matches: Most & Second-Most Digit Alternator',
        description: 'Digit Matches strategy that alternates between the most and second-most frequent digits.',
    },
    {
        id: 'over-2-under-7-master-bot',
        title: 'Over 2 / Under 7 Master Bot',
        description: 'Digit Over/Under strategy.',
    },
    {
        id: 'double-with-analysis',
        title: 'Double (With Analysis)',
        description: 'Digit Over/Under strategy with martingale recovery and entry analysis.',
    },
    {
        id: 'final-judge',
        title: 'Final Judge',
        description: 'Digit Over/Under strategy with martingale recovery.',
    },
    {
        id: 'kuomoka-over-3',
        title: 'Kuomoka Over 3',
        description: 'Digit Under strategy with martingale recovery.',
    },
    {
        id: 'last-digit-martingale',
        title: 'Last Digit Bot with Martingale',
        description: 'Digit Under strategy with martingale recovery.',
    },
];
