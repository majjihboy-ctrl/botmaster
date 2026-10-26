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

const importAsTheAppDoes = async xmlText => {
    const { default: BlockConversion } = await import('../../backward-compatibility');
    const converted = new BlockConversion().convertStrategy(Blockly.utils.xml.textToDom(xmlText), false);
    const registered = Object.keys(window.Blockly.Blocks);
    const unknown = [
        ...new Set(Array.from(converted.querySelectorAll('block')).map(b => b.getAttribute('type'))),
    ].filter(type => !registered.includes(type));
    return { converted, unknown };
};

const loadConverted = converted => {
    const workspace = new Blockly.Workspace();
    const varDB = new Blockly.Names('window');
    varDB.variableMap = workspace.getVariableMap();
    Blockly.JavaScript.variableDB_ = varDB;
    Blockly.derivWorkspace = workspace;
    Blockly.Xml.domToWorkspace(converted, workspace);
    return workspace;
};

describe('blocks used by bots from the previous platform', () => {
    it('are all registered, so the importer accepts the bot', async () => {
        const { unknown } = await importAsTheAppDoes(BOT);
        expect(unknown).toEqual([]);
    });

    it('virtual hook blocks use the real engine feature', async () => {
        const { converted } = await importAsTheAppDoes(BOT);
        const code = DBot.generateCode.call({ workspace: loadConverted(converted) });
        expect(code).toContain('Bot.configureVirtualHook({ virtualLosses: 1, realWins: 2 });');
        expect(code).toContain('Bot.enableVirtualHook(true);');
        expect(code).not.toContain('__VH__');
    });

    it('keeps the alternate-markets setting that the old bots stored under different field names', async () => {
        const { converted } = await importAsTheAppDoes(BOT);
        const code = DBot.generateCode.call({ workspace: loadConverted(converted) });
        expect(code).toContain('Bot.setAlternateMarkets(true, 3);');
    });

    it('scan-all-markets does nothing when unticked and stops the bot with an error when ticked', async () => {
        const off = DBot.generateCode.call({ workspace: loadConverted((await importAsTheAppDoes(BOT)).converted) });
        expect(off).not.toContain('Scan all markets');

        const on = BOT.replace(
            '<field name="SCAN_ALL_MARKETS">FALSE</field>',
            '<field name="SCAN_ALL_MARKETS">TRUE</field>'
        );
        const code = DBot.generateCode.call({ workspace: loadConverted((await importAsTheAppDoes(on)).converted) });
        expect(code).toMatch(/throw new Error\(".*Scan all markets is not supported/);
    });

    it('still saves with the current field names and reloads', async () => {
        const { converted } = await importAsTheAppDoes(BOT);
        const saved = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(loadConverted(converted)));
        expect(saved).toContain('type="virtual_hook_enabler"');
        expect(saved).toContain('ALT_MARKETS_ENABLED');
        // The app's own save adds the is_dbot marker (convertStrategyToIsDbot); the bare serializer does not.
        const again = await importAsTheAppDoes(saved.replace('<xml ', '<xml is_dbot="true" '));
        expect(again.unknown).toEqual([]);
    });
});
