import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.tool_binarytools = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            type: 'tool_binarytools',
            message0: localize('Deriv %1 with sound: %2 %3'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'COLOR',
                    options: [
                        [localize('green'), 'green'],
                        [localize('red'), 'red'],
                        [localize('blue'), 'blue'],
                    ],
                },
                {
                    type: 'field_dropdown',
                    name: 'SOUND',
                    options: [
                        [localize('Silent'), 'silent'],
                        [localize('Beep'), 'beep'],
                    ],
                },
                {
                    type: 'field_input',
                    name: 'NAME',
                    text: 'Binarytool',
                },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: window.Blockly.Colours.Special3.colour,
            colourSecondary: window.Blockly.Colours.Special3.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special3.colourTertiary,
            tooltip: localize('Binarytools utility block.'),
            category: window.Blockly.Categories.Miscellaneous,
        };
    },
    meta() {
        return {
            display_name: localize('Binarytools'),
            description: localize('Utility helper with color and sound options.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.tool_binarytools = block => {
    const color = block.getFieldValue('COLOR');
    const sound = block.getFieldValue('SOUND');
    const name = block.getFieldValue('NAME');
    const code = `
// Binarytools
window.__BinaryTools = { color: '${color}', sound: '${sound}', name: '${name}' };
`;
    return code;
};
