import { localize } from '@deriv-com/translations';

// Virtual Hook settings. Blocks run inside the bot sandbox, which cannot see the engine's `window`, so the
// block talks to the engine through `Bot.configureVirtualHook` (see trade/VirtualHook.js for the rules).
window.Blockly.Blocks.vh_settings = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize(
                'Virtual Hook: go real after %1 virtual loss(es) in a row, back to virtual after %2 real win(s)'
            ),
            args0: [
                {
                    type: 'field_number',
                    name: 'VIRTUAL_LOSSES',
                    value: 1,
                    min: 1,
                    max: 100,
                    precision: 1,
                },
                {
                    type: 'field_number',
                    name: 'REAL_WINS',
                    value: 2,
                    min: 1,
                    max: 100,
                    precision: 1,
                },
            ],
            nextStatement: null,
            previousStatement: null,
            colour: window.Blockly.Colours.Special3.colour,
            colourSecondary: window.Blockly.Colours.Special3.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special3.colourTertiary,
            tooltip: localize(
                'While Virtual Hook is on, trades are simulated (no money) until the chosen number of virtual losses in a row, then real trades are placed until the chosen number of real wins, then it goes back to virtual.'
            ),
            category: window.Blockly.Categories.Miscellaneous,
        };
    },
    meta() {
        return {
            display_name: localize('Virtual Hook: Settings'),
            description: localize(
                'Set how many virtual losses in a row switch the bot to real trades, and how many real wins switch it back to virtual.'
            ),
        };
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.vh_settings = block => {
    const losses = Math.max(1, Math.floor(Number(block.getFieldValue('VIRTUAL_LOSSES')) || 1));
    const wins = Math.max(1, Math.floor(Number(block.getFieldValue('REAL_WINS')) || 1));
    return `Bot.configureVirtualHook({ virtualLosses: ${losses}, realWins: ${wins} });\n`;
};
