// Every bot gets the Alternate markets setting in Trade parameters, so market switching can be turned on
// from any bot. A bot that already has it is left alone; otherwise it is added switched off (every 1 run),
// which changes nothing about how the bot trades until the user ticks it.
export const ensureAlternateMarketsBlock = xml => {
    const children = el => Array.from(el.children);
    const named = (el, tag, name) =>
        children(el).find(
            child => child.tagName.toLowerCase() === tag && (!name || child.getAttribute('name') === name)
        );

    xml.querySelectorAll('block[type="trade_definition"]').forEach(el_trade_definition => {
        if (el_trade_definition.querySelector('block[type="trade_definition_alternate_markets"]')) return;

        const el_options = named(el_trade_definition, 'statement', 'TRADE_OPTIONS');
        let el_last = el_options && named(el_options, 'block');
        if (!el_last) return;

        // Walk to the end of the Trade parameters stack.
        let el_next = named(el_last, 'next');
        while (el_next && named(el_next, 'block')) {
            el_last = named(el_next, 'block');
            el_next = named(el_last, 'next');
        }

        const doc = xml.ownerDocument;
        const create = (tag, attributes = {}, text) => {
            const el = doc.createElementNS(el_last.namespaceURI, tag);
            Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value));
            if (text !== undefined) el.textContent = text;
            return el;
        };
        const el_block = create('block', {
            type: 'trade_definition_alternate_markets',
            deletable: 'false',
            movable: 'false',
        });
        el_block.appendChild(create('field', { name: 'ALT_MARKETS_ENABLED' }, 'FALSE'));
        el_block.appendChild(create('field', { name: 'ALT_MARKETS_EVERY' }, '1'));

        if (!el_next) {
            el_next = create('next');
            el_last.appendChild(el_next);
        }
        el_next.appendChild(el_block);
    });
    return xml;
};
