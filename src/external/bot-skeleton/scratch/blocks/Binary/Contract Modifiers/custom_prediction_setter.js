import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.custom_prediction_setter = {
    init() {
        this.jsonInit({
            message0: localize('set custom prediction %1'),
            args0: [{ type: 'field_number', name: 'PRED', value: 1, min: 0, max: 9, precision: 1 }],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special2.colour,
            colourSecondary: window.Blockly.Colours.Special2.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special2.colourTertiary,
            tooltip: localize('Set custom predictions on your contract type anywhere in the blocks.'),
            category: window.Blockly.Categories.Miscellaneous,
        });
    },
    meta() {
        return {
            display_name: localize('Custom Prediction Setter'),
            description: localize('Set prediction digit for digits contracts dynamically.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.custom_prediction_setter = block => {
    const p = Number(block.getFieldValue('PRED')) || 0;
    const code = `window.BinaryBotCustomPrediction = ${p};\n`;
    return code;
};
