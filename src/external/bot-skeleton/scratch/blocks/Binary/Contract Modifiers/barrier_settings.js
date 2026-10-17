import { localize } from '@deriv-com/translations';
import { config } from '../../../../constants/config';
import { modifyContextMenu } from '../../../utils';

// Standalone Barrier settings block (independent of trade_definition_tradeoptions UI)
window.Blockly.Blocks.barrier_settings = {
    init() {
        this.jsonInit(this.definition());

        this.appendDummyInput()
            .appendField(localize('First barrier'))
            .appendField(new window.Blockly.FieldDropdown(config().BARRIER_TYPES), 'BARRIER1_TYPE')
            .appendField(new window.Blockly.FieldNumber(1, -999999, 999999, 0.01), 'BARRIER1');

        this.appendDummyInput()
            .appendField(localize('Second barrier'))
            .appendField(new window.Blockly.FieldDropdown(config().BARRIER_TYPES), 'BARRIER2_TYPE')
            .appendField(new window.Blockly.FieldNumber(-1, -999999, 999999, 0.01), 'BARRIER2');
    },
    definition() {
        return {
            type: 'barrier_settings',
            message0: localize('Barrier settings'),
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special2.colour,
            colourSecondary: window.Blockly.Colours.Special2.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special2.colourTertiary,
            tooltip: localize('Configure first and second barriers (absolute or relative).'),
            category: window.Blockly.Categories.Miscellaneous,
        };
    },
    meta() {
        return {
            display_name: localize('Barrier settings'),
            description: localize('Set barrier types and values used by your strategy.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.barrier_settings = block => {
    const t1 = block.getFieldValue('BARRIER1_TYPE');
    const v1 = Number(block.getFieldValue('BARRIER1'));
    const t2 = block.getFieldValue('BARRIER2_TYPE');
    const v2 = Number(block.getFieldValue('BARRIER2'));
    const code = `
// Barrier settings
window.__Barrier = { first: { type: '${t1}', value: ${v1} }, second: { type: '${t2}', value: ${v2} } };
`;
    return code;
};
