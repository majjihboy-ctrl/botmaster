import fs from 'fs';
/**
 * Bots imported from the previous platform wrap their stake in `utt_licence_lock`. The block must be
 * accepted by the importer and behave as a plain pass-through of the stake plugged into it.
 */
jest.mock('../../../services/api/api-base', () => ({ api_base: {} }));
jest.mock('../../../services/api/api-helpers', () => ({ __esModule: true, default: { instance: {} } }));
jest.mock('../../../services/api/ticks_service', () => ({ __esModule: true, default: class {} }));
jest.mock('../../../services/tradeEngine/utils/interpreter', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('../../dbot-store', () => ({
    __esModule: true,
    default: { instance: { client: { is_logged_in: true, loginid: 'CR123', currency: 'USD' } } },
}));

const BOT = `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables><variable id="v1">UTT | Stake</variable></variables>
  <block type="trade_definition" id="td" x="0" y="0">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="m1">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">1HZ100V</field>
        <next>
          <block type="trade_definition_tradetype" id="m2">
            <field name="TRADETYPECAT_LIST">digits</field>
            <field name="TRADETYPE_LIST">overunder</field>
            <next>
              <block type="trade_definition_contracttype" id="m3">
                <field name="TYPE_LIST">DIGITOVER</field>
                <next>
                  <block type="trade_definition_candleinterval" id="m4">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="m5">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="m6">
                            <field name="RESTARTONERROR">TRUE</field>
                            <next>
                              <block type="trade_definition_alternate_markets" id="alt">
                                <field name="ALTERNATE_MARKETS">TRUE</field>
                                <field name="ALTERNATE_RUNS">3</field>
                                <next>
                                  <block type="trade_definition_scan_all_markets" id="scan">
                                    <field name="SCAN_ALL_MARKETS">FALSE</field>
                                  </block>
                                </next>
                              </block>
                            </next>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="INITIALIZATION">
      <block type="variables_set" id="i1">
        <field name="VAR" id="v1">UTT | Stake</field>
        <value name="VALUE"><block type="math_number" id="i2"><field name="NUM">0.5</field></block></value>
        <next>
          <block type="virtual_hook_settings" id="vh1">
            <field name="VIRTUAL_LOSSES">1</field>
            <field name="REAL_WINS">2</field>
            <next><block type="virtual_hook_enabler" id="vh2"><field name="VIRTUAL_HOOK_STATE">enable</field></block></next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="to">
        <mutation has_first_barrier="false" has_second_barrier="false" has_prediction="true"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <value name="DURATION"><block type="math_number" id="d1"><field name="NUM">1</field></block></value>
        <value name="AMOUNT">
          <block type="utt_licence_lock" id="lock">
            <field name="HOST">old-platform.example</field>
            <value name="STAKE"><block type="variables_get" id="g1"><field name="VAR" id="v1">UTT | Stake</field></block></value>
          </block>
        </value>
        <value name="PREDICTION"><shadow type="math_number_positive" id="p0"><field name="NUM">1</field></shadow></value>
      </block>
    </statement>
  </block>
  <block type="before_purchase" id="bp" x="0" y="400">
    <statement name="BEFOREPURCHASE_STACK"><block type="purchase" id="pu"><field name="PURCHASE_LIST">DIGITOVER</field></block></statement>
  </block>
  <block type="after_purchase" id="ap" x="600" y="0">
    <statement name="AFTERPURCHASE_STACK"><block type="trade_again" id="ta"></block></statement>
  </block>
</xml>`;

let Blockly;
let DBot;

beforeAll(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    require('@deriv-com/translations').localize.mockImplementation((text, values = {}) =>
        text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => (values[key] !== undefined ? values[key] : m))
    );
    const { loadBlockly } = await import('../../blockly');
    await loadBlockly(false);
    Blockly = window.Blockly;
    ['initSvg', 'renderEfficiently', 'queueRender', 'render', 'bumpNeighbours', 'scheduleSnapAndBump'].forEach(n => {
        if (typeof Blockly.Block.prototype[n] !== 'function') Blockly.Block.prototype[n] = function () {};
    });
    DBot = (await import('../../dbot')).default;
}, 120000);

const load = xml => {
    const workspace = new Blockly.Workspace();
    const varDB = new Blockly.Names('window');
    varDB.variableMap = workspace.getVariableMap();
    Blockly.JavaScript.variableDB_ = varDB;
    Blockly.derivWorkspace = workspace;
    Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml), workspace);
    return workspace;
};

// A bare bot: Trade parameters without any alternate-markets block (like a free bot or an older export).
const BARE_BOT = BOT.replace(
    /<next>\s*<block type="trade_definition_alternate_markets"[\s\S]*?<\/block>\s*<\/next>/,
    ''
)
    .replace(/<next>\s*<block type="trade_definition_scan_all_markets"[\s\S]*?<\/block>\s*<\/next>/, '')
    .replace(/\s*<block type="trade_definition_scan_all_markets"[\s\S]*?<\/block>/, '');

const convert = async xmlText => {
    const { default: BlockConversion } = await import('../../backward-compatibility');
    const conversion = new BlockConversion();
    const converted = conversion.convertStrategy(Blockly.utils.xml.textToDom(xmlText), false);
    conversion.ensureAlternateMarketsBlock(converted);
    return { converted, conversion };
};
const countAlt = dom => dom.querySelectorAll('block[type="trade_definition_alternate_markets"]').length;
const loadDom = converted => {
    const workspace = new Blockly.Workspace();
    const varDB = new Blockly.Names('window');
    varDB.variableMap = workspace.getVariableMap();
    Blockly.JavaScript.variableDB_ = varDB;
    Blockly.derivWorkspace = workspace;
    Blockly.Xml.domToWorkspace(converted, workspace);
    return workspace;
};

describe('every loaded bot gets the Alternate markets setting', () => {
    it('adds it, switched off, to a bot that does not have it', async () => {
        expect(BARE_BOT).not.toContain('trade_definition_alternate_markets');
        const { converted } = await convert(BARE_BOT);
        expect(countAlt(converted)).toBe(1);

        const workspace = loadDom(converted);
        const trade_parameters = workspace.getTopBlocks().find(b => b.type === 'trade_definition');
        const alt = trade_parameters.getChildByType('trade_definition_alternate_markets');
        expect(alt.getFieldValue('ALT_MARKETS_ENABLED')).toBe('FALSE');
        expect(Number(alt.getFieldValue('ALT_MARKETS_EVERY'))).toBe(1);
        // At the end of the Trade parameters stack, right after restart-on-error.
        expect(alt.getPreviousBlock().type).toBe('trade_definition_restartonerror');
    });

    it('does not change how the bot trades until the box is ticked', async () => {
        const before = DBot.generateCode.call({ workspace: loadDom((await convert(BARE_BOT)).converted) });
        expect(before).toContain('Bot.setAlternateMarkets(false, 1);');
        expect(before).toContain('Bot.purchase(');
    });

    it('leaves a bot that already has the setting alone (including its saved values)', async () => {
        expect(BOT).toContain('trade_definition_alternate_markets');
        const { converted } = await convert(BOT);
        expect(countAlt(converted)).toBe(1);
        const code = DBot.generateCode.call({ workspace: loadDom(converted) });
        expect(code).toContain('Bot.setAlternateMarkets(true, 3);');
    });

    it('is idempotent: loading, saving and loading again never adds a second one', async () => {
        const first = await convert(BARE_BOT);
        const saved = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(loadDom(first.converted)));
        const second = await convert(saved.replace('<xml ', '<xml is_dbot="true" '));
        expect(countAlt(second.converted)).toBe(1);
    });

    it('works for all the free bots', async () => {
        const dir = `${__dirname}/../../../../../xml/free-bots`;
        const files = fs.readdirSync(dir).filter(name => name.endsWith('.xml'));
        expect(files.length).toBeGreaterThan(20);
        for (const file of files) {
            const { converted } = await convert(fs.readFileSync(`${dir}/${file}`, 'utf8').replace(/^\uFEFF/, ''));
            expect([file, countAlt(converted)]).toEqual([file, 1]);
            const workspace = loadDom(converted);
            expect(workspace.getAllBlocks().some(b => b.type === 'trade_definition_alternate_markets')).toBe(true);
            workspace.dispose();
        }
    });
});
