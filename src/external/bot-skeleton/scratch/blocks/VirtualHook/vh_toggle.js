import { localize } from '@deriv-com/translations';

window.Blockly.Blocks.vh_toggle = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
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
            tooltip: localize('Turn Virtual Hook on or off. While on, the bot starts by trading virtually (no money).'),
            category: window.Blockly.Categories.Miscellaneous,
        };
    },
    meta() {
        return {
            display_name: localize('Virtual Hook: Enable/Disable'),
            description: localize('Enable or disable Virtual Hook during the strategy run.'),
        };
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.vh_toggle = block => {
    const enabled = block.getFieldValue('STATE') === 'enable';
    return `Bot.enableVirtualHook(${enabled});\n`;
};
