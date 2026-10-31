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

describe('default Bot Builder workspace (what Reset loads)', () => {
    const MAIN_XML = fs.readFileSync(`${__dirname}/../../xml/main.xml`, 'utf8').replace(/^\uFEFF/, '');

    it('is well-formed XML (the browser rejects the whole default layout otherwise)', () => {
        const doc = new DOMParser().parseFromString(MAIN_XML, 'application/xml');
        expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    });

    it('has the Alternate markets setting inside Trade parameters, switched off by default', () => {
        const workspace = new Blockly.Workspace();
        Blockly.derivWorkspace = workspace;
        Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(MAIN_XML), workspace);
        const trade_parameters = workspace.getTopBlocks().find(b => b.type === 'trade_definition');
        const alt = trade_parameters.getChildByType('trade_definition_alternate_markets');
        expect(alt).toBeTruthy();
        expect(alt.getFieldValue('ALT_MARKETS_ENABLED')).toBe('FALSE');
        expect(Number(alt.getFieldValue('ALT_MARKETS_EVERY'))).toBe(1);
        // It sits at the end of the Trade parameters stack, after restart-on-error.
        expect(alt.getPreviousBlock().type).toBe('trade_definition_restartonerror');
    });
});
