// Small helpers for the AI chat: splitting a reply into text / code parts, and recognising a Deriv Bot
// XML reply so it can be loaded into Bot Builder.

export type TSegment = { type: 'text'; text: string } | { type: 'code'; lang: string; code: string };

// Splits Markdown into prose and fenced code blocks. An unterminated fence (a reply that was cut off)
// is still returned as code.
export const splitSegments = (markdown: string): TSegment[] => {
    const segments: TSegment[] = [];
    const fence = /```([\w+-]*)[^\S\n]*\n?([\s\S]*?)(?:```|$)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = fence.exec(markdown))) {
        if (match.index > last) segments.push({ type: 'text', text: markdown.slice(last, match.index) });
        segments.push({ type: 'code', lang: match[1].toLowerCase(), code: match[2].replace(/\n$/, '') });
        last = fence.lastIndex;
        if (match[0].length === 0) fence.lastIndex += 1;
    }
    if (last < markdown.length) segments.push({ type: 'text', text: markdown.slice(last) });
    return segments.filter(s => (s.type === 'text' ? s.text.trim() : s.code.trim()));
};

const REQUIRED_BLOCKS = ['trade_definition', 'before_purchase', 'after_purchase'];

// Looks like a Deriv Bot file (so the Load button is worth showing).
export const looksLikeBotXml = (code: string, lang = ''): boolean =>
    (lang === 'xml' || lang === '') && /<xml[\s>]/.test(code) && /type="trade_definition"/.test(code);

// Returns a human-readable problem, or null if the XML is well-formed and has the three required blocks.
export const checkBotXml = (xml: string): string | null => {
    if (typeof DOMParser === 'undefined') return null;
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length)
        return 'This XML is not well-formed (the reply may have been cut off).';
    const types = new Set(Array.from(doc.getElementsByTagName('block')).map(b => b.getAttribute('type')));
    const missing = REQUIRED_BLOCKS.filter(t => !types.has(t));
    return missing.length ? `The bot is missing required blocks: ${missing.join(', ')}.` : null;
};
