/**
 * Boots Botmaster's real Blockly setup (same steps as loadBlockly) and checks the custom blocks:
 * every block registers and instantiates, generates the code the engine expects, and every entry in the
 * toolbox menu is valid. Heavy browser-only services are mocked.
 */
jest.mock('../../../services/api/api-base', () => ({ api_base: {} }));
jest.mock('../../../services/api/api-helpers', () => ({ __esModule: true, default: { instance: {} } }));
jest.mock('../../../services/api/ticks_service', () => ({ __esModule: true, default: class {} }));
jest.mock('../../../services/tradeEngine/utils/interpreter', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('../../dbot-store', () => ({ __esModule: true, default: { instance: { client: {} } } }));

const NEW_BLOCKS = [
    'last_digits_condition',
    'digit_frequency',
    'even_odd_percent',
    'over_under_percent',
    'match_diff_percent',
    'rise_fall_percent',
    'vh_settings',
    'vh_toggle',
    'tool_binarytools',
    'contract_type_switcher',
    'custom_prediction_setter',
    'market_symbol_changer',
    'active_symbol_changer',
    'barrier_settings',
    'touchnotouch_offset_enabler',
    'touchnotouch_barrier_changer',
    'trade_definition_alternate_markets',
    'math_minmax',
    'btnotify',
    'apollo_purchase',
    'apollo_purchase2',
];

let Blockly;
let workspace;
const warnings = [];

beforeAll(async () => {
    jest.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(args.join(' ')));
    // The repo's translation mock returns text unchanged; the real localize() fills in {{ placeholders }},
    // and several blocks build their message that way. Mirror the real behaviour here.
    // eslint-disable-next-line global-require
    require('@deriv-com/translations').localize.mockImplementation((text, values = {}) =>
        text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (values[key] !== undefined ? values[key] : match))
    );
    const { loadBlockly } = await import('../../blockly');
    await loadBlockly(false);
    Blockly = window.Blockly;
    workspace = new Blockly.Workspace();
}, 120000);

afterAll(() => {
    workspace?.dispose();
});

const generate = type => {
    const block = workspace.newBlock(type);
    return {
        block,
        code: Blockly.JavaScript.javascriptGenerator.forBlock[type](block, Blockly.JavaScript.javascriptGenerator),
    };
};

describe('custom blocks', () => {
    it.each(NEW_BLOCKS)('%s is registered and can be created', type => {
        expect(Blockly.Blocks[type]).toBeDefined();
        const block = workspace.newBlock(type);
        expect(block.type).toBe(type);
        expect(typeof Blockly.JavaScript.javascriptGenerator.forBlock[type]).toBe('function');
    });

    it('market blocks hand their settings to the engine through Bot.* calls, not window flags', () => {
        const alt = workspace.newBlock('trade_definition_alternate_markets');
        alt.setFieldValue('TRUE', 'ALT_MARKETS_ENABLED');
        alt.setFieldValue(3, 'ALT_MARKETS_EVERY');
        expect(Blockly.JavaScript.javascriptGenerator.forBlock.trade_definition_alternate_markets(alt)).toBe(
            'Bot.setAlternateMarkets(true, 3);\n'
        );

        const forced = workspace.newBlock('active_symbol_changer');
        forced.setFieldValue('R_50', 'SYMBOL_ACTIVE_TYPE');
        expect(Blockly.JavaScript.javascriptGenerator.forBlock.active_symbol_changer(forced)).toBe(
            'Bot.setForcedSymbol("R_50");\n'
        );

        const disable = workspace.newBlock('active_symbol_changer');
        disable.setFieldValue('disable', 'SYMBOL_ACTIVE_TYPE');
        expect(Blockly.JavaScript.javascriptGenerator.forBlock.active_symbol_changer(disable)).toBe(
            'Bot.setForcedSymbol("disable");\n'
        );

        const changer = workspace.newBlock('market_symbol_changer');
        changer.setFieldValue('ENABLE', 'STATUS');
        expect(Blockly.JavaScript.javascriptGenerator.forBlock.market_symbol_changer(changer)).toBe(
            'Bot.setAlternateMarkets(true, 1);\n'
        );
        changer.setFieldValue('DISABLE', 'STATUS');
        expect(Blockly.JavaScript.javascriptGenerator.forBlock.market_symbol_changer(changer)).toBe(
            'Bot.setAlternateMarkets(false, 1);\n'
        );
    });

    it('analysis blocks call the matching Bot.* helper', () => {
        const expected = {
            last_digits_condition: 'Bot.getLastDigitsCondition',
            digit_frequency: 'Bot.getDigitFrequency',
            even_odd_percent: 'Bot.getEvenOddPercent',
            over_under_percent: 'Bot.getOverUnderPercent',
            match_diff_percent: 'Bot.getMatchDiffPercent',
            rise_fall_percent: 'Bot.getRiseFallPercent',
        };
        Object.entries(expected).forEach(([type, helper]) => {
            const { code } = generate(type);
            const text = Array.isArray(code) ? code[0] : code;
            expect(text).toContain(helper);
        });
    });

    it('"restart on error" can be followed by the Alternate markets block', () => {
        const restart = workspace.newBlock('trade_definition_restartonerror');
        expect(restart.nextConnection).not.toBeNull();
        const alt = workspace.newBlock('trade_definition_alternate_markets');
        expect(() => restart.nextConnection.connect(alt.previousConnection)).not.toThrow();
        expect(restart.getNextBlock()).toBe(alt);
    });
});

describe('toolbox menu', () => {
    let dom;

    beforeAll(async () => {
        // react-dom/server is mocked globally in this repo, so grab the element tree the toolbox hands to the
        // renderer and render it with the real React server renderer.
        // eslint-disable-next-line global-require
        const mocked_server = require('react-dom/server');
        const { ToolboxItems } = await import('@/pages/bot-builder/toolbox/toolbox-items');
        ToolboxItems();
        const element = mocked_server.renderToStaticMarkup.mock.calls.slice(-1)[0][0];
        // The repo's moduleNameMapper swaps any path containing "react-dom/server" for the mock, so load the real
        // renderer from its internal build file.
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const real_server = require(
            `${process.cwd()}/node_modules/react-dom/cjs/react-dom-server-legacy.node.development.js`
        );
        dom = Blockly.utils.xml.textToDom(real_server.renderToStaticMarkup(element));
    });

    it('is valid XML and lists every custom block', () => {
        const types = new Set([...dom.querySelectorAll('block')].map(b => b.getAttribute('type')));
        // apollo_purchase is registered (so imported bots load) but intentionally not in the menu.
        NEW_BLOCKS.filter(t => !t.startsWith('apollo_')).forEach(type => expect(types.has(type)).toBe(true));
    });

    it('only references block types that exist', () => {
        const unknown = [...dom.querySelectorAll('block, shadow')]
            .map(b => b.getAttribute('type'))
            .filter(type => !Blockly.Blocks[type]);
        expect(unknown).toEqual([]);
    });

    it('has the custom menu categories', () => {
        const ids = [...dom.querySelectorAll('category')].map(c => c.getAttribute('id'));
        ['analysis_logics', 'virtual_hook', 'binarytools', 'contract_modifiers', 'barrier_settings_category'].forEach(
            id => expect(ids).toContain(id)
        );
    });

    it('every custom block in the menu is created with exactly the default field values the menu specifies', () => {
        const custom = new Set(NEW_BLOCKS);
        const nodes = [...dom.querySelectorAll('block')].filter(b => custom.has(b.getAttribute('type')));
        expect(nodes.length).toBeGreaterThan(15);

        const mismatches = [];
        nodes.forEach(node => {
            const created = Blockly.Xml.domToBlock(node, workspace);
            expect(created).toBeTruthy();
            // Only this block's own <field> children (not those of nested shadow/value blocks).
            [...node.children]
                .filter(child => child.tagName.toLowerCase() === 'field')
                .forEach(field => {
                    const wanted = field.textContent.trim();
                    if (!wanted) return;
                    const name = field.getAttribute('name');
                    const type = node.getAttribute('type');
                    const actual = String(created.getFieldValue(name));
                    if (actual !== wanted) {
                        mismatches.push(`${type}.${name}: menu says "${wanted}", block has "${actual}"`);
                    }
                    // This Blockly build accepts any value in a dropdown without complaint, so check the value is
                    // really one of the dropdown's options (these custom blocks all have static option lists).
                    const field_on_block = created.getField(name);
                    if (field_on_block instanceof Blockly.FieldDropdown) {
                        const options = field_on_block.getOptions().map(option => String(option[1]));
                        if (!options.includes(wanted)) {
                            mismatches.push(`${type}.${name}: "${wanted}" is not one of [${options.join(', ')}]`);
                        }
                    }
                });
        });
        expect(mismatches).toEqual([]);
    });
});
