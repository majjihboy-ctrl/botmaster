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

describe('utt_licence_lock (imported legacy block)', () => {
    it('is registered, so the importer no longer rejects bots that contain it', () => {
        expect(Object.keys(Blockly.Blocks)).toContain('utt_licence_lock');
    });

    it('loads the legacy bot and passes the stake straight through to the trade', () => {
        const workspace = load(BOT);
        expect(workspace.getAllBlocks().some(b => b.type === 'utt_licence_lock')).toBe(true);
        const code = DBot.generateCode.call({ workspace });
        expect(code).toMatch(/amount\s*:\s*\+\(Number\(\(UTT__7C_Stake\)\)\.toFixed\(2\)\)/);
        expect(code).toContain('Bot.purchase(');
    });

    it('keeps the block (and its HOST text) when the bot is saved again', () => {
        const xml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(load(BOT)));
        expect(xml).toContain('type="utt_licence_lock"');
        expect(xml).toContain('old-platform.example');
    });

    it('with nothing plugged in, the stake is 0 (Deriv rejects it visibly) rather than silently wrong', () => {
        const workspace = load(
            BOT.replace(
                /<value name="STAKE">.*?<\/value>\s*<\/block>\s*<\/value>\s*<value name="PREDICTION">/s,
                '</block></value><value name="PREDICTION">'
            )
        );
        const code = DBot.generateCode.call({ workspace });
        expect(code).toMatch(/amount\s*:\s*\+\(Number\(\(0\)\)\.toFixed\(2\)\)/);
    });
});
