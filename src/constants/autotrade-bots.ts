export type TAutotradeBot = {
    id: string;
    title: string;
    category: string;
    direction: string;
    barrier: number;
    description: string;
};

// `id` must match a file name (without extension) in `src/xml/autotrade/`.
export const AUTOTRADE_BOTS: TAutotradeBot[] = [
    {
        id: 'lhl-over-2',
        title: 'LHL Over 2',
        category: 'Digits',
        direction: 'Over',
        barrier: 2,
        description: 'Low-Low-High-High-Low pattern entry, Digit Over 2, with martingale recovery.',
    },
];
