import { localize } from '@deriv-com/translations';

// Virtual Hook toggle block
window.Blockly.Blocks.vh_toggle = {
    init: function () {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            type: 'vh_toggle',
            message0: localize('Enable/Disable VH %1'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'STATE',
                    options: [
                        [localize('enable'), 'enable'],
                        [localize('disable'), 'disable'],
                    ],
                },
            ],
            nextStatement: null,
            previousStatement: null,
            colour: window.Blockly.Colours.Special3.colour,
            colourSecondary: window.Blockly.Colours.Special3.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special3.colourTertiary,
            tooltip: localize('Turn Virtual Hook on or off.'),
            category: window.Blockly.Categories.Miscellaneous,
        };
    },
    meta() {
        return {
            display_name: localize('Virtual Hook: Enable/Disable'),
            description: localize('Enable or disable Virtual Hook during strategy run.'),
        };
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.vh_toggle = function (block) {
    const state = block.getFieldValue('STATE');
    const enabled = state === 'enable';
    const code = `
// Virtual Hook: toggle
if (!window.__VH__) window.__VH__ = { enabled: false, config: {} };
window.__VH__.enabled = ${enabled};
`;
    return code;
};
