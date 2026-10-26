import { localize } from '@deriv-com/translations';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

// Present in bots made for this site's previous platform, where ticking it made the bot scan every market
// for a signal. This site has no market scanner yet, so the block is accepted (so those bots import) and:
//   - unticked: does nothing, exactly like the original;
//   - ticked:   stops the bot with a clear error, rather than quietly trading a single market.
window.Blockly.Blocks.trade_definition_scan_all_markets = {
    init() {
        this.jsonInit({
            message0: localize('Scan all markets (not supported on this site yet): {{ checkbox }}', {
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
            tooltip: localize('Market scanning is not available here. Leave this unticked.'),
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

window.Blockly.JavaScript.javascriptGenerator.forBlock.trade_definition_scan_all_markets = block => {
    if (block.getFieldValue('SCAN_ALL_MARKETS') !== 'TRUE') return '';
    const message = localize(
        'Scan all markets is not supported on this site yet. Untick it in Trade parameters to run this bot.'
    );
    return `throw new Error(${JSON.stringify(message)});\n`;
};
