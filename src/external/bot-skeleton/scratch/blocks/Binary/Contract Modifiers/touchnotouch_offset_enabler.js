import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

// Touch/NoTouch Offset Changer Enabler
window.Blockly.Blocks.touchnotouch_offset_enabler = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            type: 'touchnotouch_offset_enabler',
            message0: localize('Barrier changer status %1'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'STATUS',
                    options: [
                        [localize('enable'), 'enable'],
                        [localize('disable'), 'disable'],
                    ],
                },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special2.colour,
            colourSecondary: window.Blockly.Colours.Special2.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special2.colourTertiary,
            tooltip: localize('Enable or disable Touch/NoTouch barrier offset changer.'),
            category: window.Blockly.Categories.Miscellaneous,
        };
    },
    meta() {
        return {
            display_name: localize('Touch/NoTouch Offset Changer Enabler'),
            description: localize('This block enables or disables the barrier offset changer feature.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.touchnotouch_offset_enabler = block => {
    const status = block.getFieldValue('STATUS') === 'enable';
    const code = `
// TN Offset changer enable
window.__TNBarrier = window.__TNBarrier || { enabled: false, value: '' };
window.__TNBarrier.enabled = ${status};
`;
    return code;
};
