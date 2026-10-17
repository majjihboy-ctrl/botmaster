import { localize } from '@deriv-com/translations';

// Virtual Hook Settings block
window.Blockly.Blocks.vh_settings = {
    init: function () {
        this.jsonInit(this.definition());

        // Inputs similar to the provided SVG snapshot
        this.appendDummyInput()
            .appendField(localize('Martingale Factor'))
            .appendField(new window.Blockly.FieldNumber(1.5, 0, Infinity, 0.1), 'MARTINGALE_FACTOR');

        this.appendDummyInput()
            .appendField(localize('Max Steps'))
            .appendField(new window.Blockly.FieldNumber(3, 0, Infinity, 1), 'MAX_STEPS');

        this.appendDummyInput()
            .appendField(localize('Min. Trades on Real'))
            .appendField(new window.Blockly.FieldNumber(1, 0, Infinity, 1), 'MIN_TRADES_REAL');

        this.appendDummyInput()
            .appendField(localize('Take Profit'))
            .appendField(new window.Blockly.FieldNumber(50, 0, Infinity, 0.01), 'TAKE_PROFIT');

        this.appendDummyInput()
            .appendField(localize('Stop Loss'))
            .appendField(new window.Blockly.FieldNumber(5, 0, Infinity, 0.01), 'STOP_LOSS');
    },
    definition() {
        return {
            type: 'vh_settings',
            message0: localize('set Virtual Hook Settings'),
            nextStatement: null,
            previousStatement: null,
            colour: window.Blockly.Colours.Special3.colour,
            colourSecondary: window.Blockly.Colours.Special3.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special3.colourTertiary,
            args0: [],
            tooltip: localize('Configure the Virtual Hook behaviour and limits.'),
            category: window.Blockly.Categories.Miscellaneous,
        };
    },
    meta() {
        return {
            display_name: localize('Virtual Hook: Settings'),
            description: localize('Set VH martingale factor, steps, min trades on real, TP and SL.'),
        };
    },
};

// Generator: stores values in a global VH config object
window.Blockly.JavaScript.javascriptGenerator.forBlock.vh_settings = function (block) {
    const martingale = Number(block.getFieldValue('MARTINGALE_FACTOR'));
    const maxSteps = Number(block.getFieldValue('MAX_STEPS'));
    const minTradesReal = Number(block.getFieldValue('MIN_TRADES_REAL'));
    const takeProfit = Number(block.getFieldValue('TAKE_PROFIT'));
    const stopLoss = Number(block.getFieldValue('STOP_LOSS'));

    const code = `
// Virtual Hook: apply settings
if (!window.__VH__) window.__VH__ = { enabled: false, config: {} };
window.__VH__.config = {
  martingaleFactor: ${martingale},
  maxSteps: ${maxSteps},
  minTradesOnReal: ${minTradesReal},
  takeProfit: ${takeProfit},
  stopLoss: ${stopLoss},
};
`;
    return code;
};
