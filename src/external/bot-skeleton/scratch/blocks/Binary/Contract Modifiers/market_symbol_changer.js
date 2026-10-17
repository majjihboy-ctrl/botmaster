import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.market_symbol_changer = {
    init() {
        this.jsonInit({
            message0: localize('Symbol changer status %1'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'STATUS',
                    options: [
                        [localize('disable'), 'DISABLE'],
                        [localize('enable'), 'ENABLE'],
                    ],
                },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special2.colour,
            colourSecondary: window.Blockly.Colours.Special2.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special2.colourTertiary,
            tooltip: localize(
                'Enable to move to the next Continuous Indices market after every run (same as Alternate markets, every 1 run).'
            ),
            category: window.Blockly.Categories.Miscellaneous,
        });
    },
    meta() {
        return {
            display_name: localize('Market Symbol Changer'),
            description: localize('Toggle automatic market switching after every run.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.market_symbol_changer = block => {
    // ENABLE = move to the next Continuous Indices market after every run; DISABLE = stay on the current one.
    const enabled = block.getFieldValue('STATUS') === 'ENABLE';
    return `Bot.setAlternateMarkets(${enabled}, 1);\n`;
};
