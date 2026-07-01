export type TFreeBot = {
    id: string;
    title: string;
    description: string;
    featured?: boolean;
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
        featured: true,
    },
];
