import { localize } from '@deriv-com/translations';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

// Block to request a symbol change at runtime (used in procedures like "Switch Markets")
window.Blockly.Blocks.active_symbol_changer = {
    init() {
        this.jsonInit({
            message0: localize('Set active symbol to: {{ symbol }}', { symbol: '%1' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'SYMBOL_ACTIVE_TYPE',
                    options: [
                        [localize('Disable switching'), 'disable'],
                        // Popular continuous indices; users can extend via XML
                        ['Volatility 10 (1s)', '1HZ10V'],
                        ['Volatility 25 (1s)', '1HZ25V'],
                        ['Volatility 50 (1s)', '1HZ50V'],
                        ['Volatility 75 (1s)', '1HZ75V'],
                        ['Volatility 100 (1s)', '1HZ100V'],
                        ['Volatility 10 Index', 'R_10'],
                        ['Volatility 25 Index', 'R_25'],
                        ['Volatility 50 Index', 'R_50'],
                        ['Volatility 75 Index', 'R_75'],
                        ['Volatility 100 Index', 'R_100'],
                    ],
                },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
        });
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.active_symbol_changer = block => {
    const symbol = block.getFieldValue('SYMBOL_ACTIVE_TYPE') || 'disable';
    // Blocks run in the bot sandbox, so the engine is reached through the Bot interface (not window flags).
    return `Bot.setForcedSymbol(${JSON.stringify(symbol)});\n`;
};
