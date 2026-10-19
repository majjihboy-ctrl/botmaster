import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

// Touch/NoTouch Barrier Changer
window.Blockly.Blocks.touchnotouch_barrier_changer = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            type: 'touchnotouch_barrier_changer',
            message0: localize('Set barrier changer to: %1'),
            args0: [{ type: 'field_input', name: 'VALUE', text: 'abc' }],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special2.colour,
            colourSecondary: window.Blockly.Colours.Special2.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special2.colourTertiary,
            tooltip: localize('Changes the offset of a Touch/NoTouch bot barrier.'),
            category: window.Blockly.Categories.Miscellaneous,
        };
    },
    meta() {
        return {
            display_name: localize('Touch/NoTouch Barrier Changer'),
            description: localize('Provide the barrier change value (e.g. +0.5, -0.7, 1).'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.touchnotouch_barrier_changer = block => {
    const val = block.getFieldValue('VALUE');
    const code = `
// TN Barrier change value
window.__TNBarrier = window.__TNBarrier || { enabled: false, value: '' };
window.__TNBarrier.value = '${val}';
`;
    return code;
};
