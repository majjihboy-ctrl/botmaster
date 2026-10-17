import { localize } from '@deriv-com/translations';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

// Adds an option in Trade parameters under TRADE_OPTIONS after restart-on-error
// "Alternate markets (Continuous Indices only): [checkbox] every [number] run(s)"
window.Blockly.Blocks.trade_definition_alternate_markets = {
    init() {
        this.jsonInit({
            message0: localize('Alternate markets (Continuous Indices only): {{ checkbox }} {{ every }} {{ runs }}', {
                checkbox: '%1',
                every: '%2',
                runs: '%3 %4',
            }),
            args0: [
                {
                    type: 'field_checkbox',
                    name: 'ALT_MARKETS_ENABLED',
                    checked: false,
                    class: 'blocklyCheckbox',
                },
                {
                    type: 'field_label',
                    text: localize('every'),
                },
                {
                    type: 'field_number',
                    name: 'ALT_MARKETS_EVERY',
                    value: 1,
                    min: 1,
                    precision: 1,
                },
                {
                    type: 'field_label',
                    text: localize('run(s)'),
                },
            ],
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            previousStatement: null,
            nextStatement: null,
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
    required_inputs: ['ALT_MARKETS_ENABLED', 'ALT_MARKETS_EVERY'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.trade_definition_alternate_markets = block => {
    const enabled = block.getFieldValue('ALT_MARKETS_ENABLED') === 'TRUE';
    const every = Math.max(1, Math.floor(Number(block.getFieldValue('ALT_MARKETS_EVERY'))) || 1);
    // The trade engine rotates the market every `every` runs (see applyMarketSwitch in trade/Ticks.js).
    return `Bot.setAlternateMarkets(${enabled}, ${every});\n`;
};
