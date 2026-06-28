export type TPremiumBot = {
    id: string;
    title: string;
    description: string;
    whatsapp_url: string;
};

// `id` must match a file name (without extension) in `src/xml/free-bots/`.
// These bots are NOT directly loadable — users are sent to WhatsApp to
// request an access code rather than clicking straight into Bot Builder.
export const PREMIUM_BOTS: TPremiumBot[] = [
    {
        id: 'fable-v1-pro',
        title: 'Fable V1 Pro',
        description: 'Digit Over/Under recovery strategy with martingale.',
        whatsapp_url: 'https://wa.me/254745650243?text=' + encodeURIComponent('Hi, I\'d like the access code for Fable V1 Pro'),
    },
];
