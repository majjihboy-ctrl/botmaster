/**
 * Every reference bot in api/_lib/library must load into the app's real Blockly workspace and generate
 * engine code. Set LIB_DIR to point at another folder (then failures are reported, not asserted) and
 * LIB_REPORT to write a JSON report.
 */
import fs from 'fs';
import path from 'path';

jest.mock('../../../services/api/api-base', () => ({ api_base: {} }));
jest.mock('../../../services/api/api-helpers', () => ({ __esModule: true, default: { instance: {} } }));
jest.mock('../../../services/api/ticks_service', () => ({ __esModule: true, default: class {} }));
jest.mock('../../../services/tradeEngine/utils/interpreter', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('../../dbot-store', () => ({
    __esModule: true,
    default: { instance: { client: { is_logged_in: true, loginid: 'CR123', currency: 'USD' } } },
}));

const path_root = path.resolve(__dirname, '../../../../../../api/_lib/library');
const LIB_DIR = process.env.LIB_DIR || path_root;
let Blockly;
let DBot;
let BlockConversion;
const warnings = [];

beforeAll(async () => {
    jest.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(args.join(' ')));
    jest.spyOn(console, 'error').mockImplementation((...args) => warnings.push(`ERR ${args.join(' ')}`));
    require('@deriv-com/translations').localize.mockImplementation((text, values = {}) =>
        text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (values[key] !== undefined ? values[key] : match))
    );
    const { loadBlockly } = await import('../../blockly');
    await loadBlockly(false);
    Blockly = window.Blockly;
    // jsdom has no innerText; real browsers (which the legacy converter targets) do.
    if (!('innerText' in window.Element.prototype)) {
        Object.defineProperty(window.Element.prototype, 'innerText', {
            get() { return this.textContent; },
            set(v) { this.textContent = v; },
        });
    }
    ['initSvg', 'renderEfficiently', 'queueRender', 'render', 'bumpNeighbours', 'scheduleSnapAndBump'].forEach(name => {
        if (typeof Blockly.Block.prototype[name] !== 'function') Blockly.Block.prototype[name] = function () {};
    });
    DBot = (await import('../../dbot')).default;
    BlockConversion = (await import('../../backward-compatibility')).default;
}, 180000);

const listXml = dir =>
    fs.existsSync(dir)
        ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
              entry.isDirectory()
                  ? listXml(path.join(dir, entry.name)).map(f => path.join(entry.name, f))
                  : /\.xml$/i.test(entry.name) ? [entry.name] : []
          )
        : [];
const files = listXml(LIB_DIR).sort();
const report = [];

describe('library bots', () => {
    it.each(files)('%s', file => {
        const text = fs.readFileSync(path.join(LIB_DIR, file), 'utf8');
        const row = { file, input_blocks: (text.match(/<block /g) || []).length, legacy: !/is_dbot="true"/.test(text.slice(0, 500)) };
        warnings.length = 0;
        let dialog = false;
        try {
            // The app keeps one global main workspace (Blockly.derivWorkspace); converters and code
            // generators reach for it, so give them one.
            const workspace = new Blockly.Workspace();
            workspace.isFlyoutVisible = () => false;
            workspace.getFlyout = () => null;
            Blockly.derivWorkspace = workspace;
            let dom = Blockly.utils.xml.textToDom(text);
            dom = new BlockConversion().convertStrategy(dom, () => { dialog = true; });
            row.dialog = dialog;
            const varDB = new Blockly.Names('window');
            varDB.variableMap = workspace.getVariableMap();
            Blockly.JavaScript.variableDB_ = varDB;
            Blockly.Xml.domToWorkspace(dom, workspace);
            row.loaded_blocks = workspace.getAllBlocks(false).length;
            row.load = row.loaded_blocks > 0 ? 'ok' : 'EMPTY';
            try {
                const code = DBot.generateCode.call({ workspace });
                row.codegen = code && code.length > 50 ? 'ok' : 'EMPTY';
                row.code_len = (code || '').length;
            } catch (e) {
                row.codegen = `FAIL: ${String(e.message).slice(0, 80)}`;
                row.codegen_stack = String(e.stack).split('\n').slice(0, 4).join(' | ').slice(0, 300);
            }
        } catch (e) {
            row.load = `FAIL: ${String(e.message).slice(0, 90)}`;
            row.load_stack = String(e.stack).split('\n').slice(0, 4).join(' | ').slice(0, 300);
        }
        row.warnings = warnings.length;
        if (!process.env.LIB_DIR) {
            expect(row.load).toBe('ok');
            expect(row.codegen).toBe('ok');
        }
        if (warnings.length) row.first_warning = warnings[0].slice(0, 100);
        report.push(row);
    });
    afterAll(() => {
        if (process.env.LIB_REPORT) fs.writeFileSync(process.env.LIB_REPORT, JSON.stringify(report, null, 1));
    });
});
