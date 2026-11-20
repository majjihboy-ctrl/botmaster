import { localize } from '@deriv-com/translations';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

// "Scan all markets": while the bot is waiting for its before-purchase rules to pass, the trade engine checks each
// Continuous Index in turn (one tick each) and buys on the first market where the rules pass.
// Engine side: Bot.setScanAllMarkets, see trade/Ticks.js.
window.Blockly.Blocks.trade_definition_scan_all_markets = {
    init() {
        this.jsonInit({
            message0: localize('Scan all markets (Continuous Indices only): {{ checkbox }}', {
                checkbox: '%1',
            }),
            args0: [
                {
                    type: 'field_checkbox',
                    name: 'SCAN_ALL_MARKETS',
                    checked: false,
                    class: 'blocklyCheckbox',
                },
            ],
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            previousStatement: null,
            nextStatement: null,
            tooltip: localize(
                'While waiting for your entry rules, check each Continuous Index in turn and trade the first one where they pass.'
            ),
        });

        this.setMovable(false);
        this.setDeletable(false);
    },
    onchange(/* event */) {
        if (!this.workspace || window.Blockly.derivWorkspace.isFlyoutVisible || this.workspace.isDragging()) {
            return;
        }

        this.enforceLimitations();
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    enforceLimitations: window.Blockly.Blocks.trade_definition_market.enforceLimitations,
    required_inputs: ['SCAN_ALL_MARKETS'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.trade_definition_scan_all_markets = block =>
    `Bot.setScanAllMarkets(${block.getFieldValue('SCAN_ALL_MARKETS') === 'TRUE'});\n`;
