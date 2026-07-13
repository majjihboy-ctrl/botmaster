export type TPremiumBot = {
    id: string;
    title: string;
    description: string;
    whatsapp_url: string;
};

// `id` must match a file name (without extension) in `src/xml/free-bots/`.
// These bots are NOT directly loadable — users are sent to WhatsApp to
// request an access code rather than clicking straight into Bot Builder.
export const PREMIUM_BOTS: TPremiumBot[] = [];
