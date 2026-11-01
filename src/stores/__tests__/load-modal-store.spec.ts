import LoadModalStore from '../load-modal-store';

// The store pulls in the whole bot-skeleton; only the DOM helper it uses to load strategies matters here.
jest.mock('@/external/bot-skeleton', () => ({
    getSavedWorkspaces: jest.fn(),
    load: jest.fn(),
    removeExistingWorkspace: jest.fn(),
    save_types: { LOCAL: 'local', UNSAVED: 'unsaved' },
    saveWorkspaceToRecent: jest.fn(),
}));
jest.mock('@/external/bot-skeleton/scratch/utils', () => ({
    inject_workspace_options: {},
    updateXmlValues: jest.fn(),
}));
jest.mock('@/external/bot-skeleton/utils/workspace', () => ({ isDbotRTL: () => false }));

const BARE_BOT = `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true">
  <block type="trade_definition" id="td">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="m1">
        <next>
          <block type="trade_definition_restartonerror" id="m6">
            <field name="RESTARTONERROR">TRUE</field>
          </block>
        </next>
      </block>
    </statement>
  </block>
</xml>`;

const WITH_ALT = BARE_BOT.replace(
    '<field name="RESTARTONERROR">TRUE</field>',
    '<field name="RESTARTONERROR">TRUE</field><next><block type="trade_definition_alternate_markets" id="alt"><field name="ALT_MARKETS_ENABLED">TRUE</field><field name="ALT_MARKETS_EVERY">3</field></block></next>'
);

const altBlocks = (dom: Element | Document) => dom.querySelectorAll('block[type="trade_definition_alternate_markets"]');

describe('LoadModalStore.loadStrategyOnBotBuilder (the path Free Bots, AI and recent bots use)', () => {
    const setup = (xml: string) => {
        const convertedDom = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
        const clearWorkspaceAndLoadFromXml = jest.fn();
        const derivWorkspace = { cleanUp: jest.fn(), clearUndo: jest.fn() };
        (window as any).Blockly = {
            xmlValues: { strategy_id: 's1', convertedDom },
            derivWorkspace,
            Xml: { clearWorkspaceAndLoadFromXml },
            utils: { idGenerator: { genUid: () => 'uid' } },
        };
        const store = new LoadModalStore({} as any, {} as any);
        return { store, convertedDom, clearWorkspaceAndLoadFromXml, derivWorkspace };
    };

    it('adds the Alternate markets setting to a bot that lacks it, before it reaches the workspace', async () => {
        const { store, convertedDom, clearWorkspaceAndLoadFromXml, derivWorkspace } = setup(BARE_BOT);
        expect(altBlocks(convertedDom)).toHaveLength(0);

        await store.loadStrategyOnBotBuilder();

        const [loadedDom, workspace] = clearWorkspaceAndLoadFromXml.mock.calls[0];
        expect(workspace).toBe(derivWorkspace);
        expect(altBlocks(loadedDom)).toHaveLength(1);
        const alt = altBlocks(loadedDom)[0];
        expect(alt.querySelector('field[name="ALT_MARKETS_ENABLED"]')?.textContent).toBe('FALSE');
        expect(alt.querySelector('field[name="ALT_MARKETS_EVERY"]')?.textContent).toBe('1');
        // At the end of the Trade parameters stack, right after restart-on-error.
        expect(alt.parentElement?.parentElement?.getAttribute('type')).toBe('trade_definition_restartonerror');
    });

    it('does not add a second one to a bot that already has it, and keeps its values', async () => {
        const { store, clearWorkspaceAndLoadFromXml } = setup(WITH_ALT);
        await store.loadStrategyOnBotBuilder();
        const [loadedDom] = clearWorkspaceAndLoadFromXml.mock.calls[0];
        expect(altBlocks(loadedDom)).toHaveLength(1);
        const alt = altBlocks(loadedDom)[0];
        expect(alt.querySelector('field[name="ALT_MARKETS_ENABLED"]')?.textContent).toBe('TRUE');
        expect(alt.querySelector('field[name="ALT_MARKETS_EVERY"]')?.textContent).toBe('3');
    });

    it('is safe to run twice on the same bot', async () => {
        const { store, clearWorkspaceAndLoadFromXml } = setup(BARE_BOT);
        await store.loadStrategyOnBotBuilder();
        await store.loadStrategyOnBotBuilder();
        const [loadedDom] = clearWorkspaceAndLoadFromXml.mock.calls[1];
        expect(altBlocks(loadedDom)).toHaveLength(1);
    });
});
