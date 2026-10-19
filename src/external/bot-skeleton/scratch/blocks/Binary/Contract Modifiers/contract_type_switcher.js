import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.contract_type_switcher = {
    init() {
        this.jsonInit({
            message0: localize('Current active contract %1'),
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
            tooltip: localize('This block makes your bot hybrid, allowing it to change to any contract type available'),
            category: window.Blockly.Categories.Miscellaneous,
        });
    },
    meta() {
        return {
            display_name: localize('Contract Type Switcher'),
            description: localize('Allow switching between contract types programmatically.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.contract_type_switcher = block => {
    const status = block.getFieldValue('STATUS');
    // Placeholder flag for downstream use.
    const code = `window.BinaryBotContractTypeSwitcher = '${status}';\n`;
    return code;
};
