import { checkBotXml, looksLikeBotXml, splitSegments } from '../chat-utils';

const BOT = `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true">
  <block type="trade_definition"></block>
  <block type="before_purchase"></block>
  <block type="after_purchase"></block>
</xml>`;

describe('splitSegments', () => {
    it('splits prose and fenced code', () => {
        expect(splitSegments('Here you go:\n```xml\n<xml/>\n```\nEnjoy')).toEqual([
            { type: 'text', text: 'Here you go:\n' },
            { type: 'code', lang: 'xml', code: '<xml/>' },
            { type: 'text', text: '\nEnjoy' },
        ]);
    });

    it('treats a reply cut off mid code block as code', () => {
        const out = splitSegments('Start\n```xml\n<xml><block');
        expect(out[1]).toEqual({ type: 'code', lang: 'xml', code: '<xml><block' });
    });

    it('handles plain text and several blocks', () => {
        expect(splitSegments('just text')).toEqual([{ type: 'text', text: 'just text' }]);
        expect(splitSegments('```js\na\n```\n```py\nb\n```').map(s => (s.type === 'code' ? s.lang : 'text'))).toEqual([
            'js',
            'py',
        ]);
    });
});

describe('bot xml helpers', () => {
    it('recognises a Deriv bot file', () => {
        expect(looksLikeBotXml(BOT, 'xml')).toBe(true);
        expect(looksLikeBotXml('<xml></xml>', 'xml')).toBe(false);
        expect(looksLikeBotXml(BOT, 'python')).toBe(false);
    });

    it('accepts a complete bot and explains what is wrong with a broken one', () => {
        expect(checkBotXml(BOT)).toBeNull();
        expect(checkBotXml(BOT.replace('</xml>', ''))).toMatch(/not well-formed/);
        expect(checkBotXml(BOT.replace('type="after_purchase"', 'type="other"'))).toMatch(/after_purchase/);
    });
});
