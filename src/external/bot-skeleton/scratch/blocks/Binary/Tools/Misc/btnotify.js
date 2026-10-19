import { localize } from '@deriv-com/translations';

// A simple variant of notify block matching friend's XML name 'btnotify'
window.Blockly.Blocks.btnotify = {
    init() {
        this.jsonInit({
            message0: localize('Notify {{ type }}: {{ message }}', { type: '%1', message: '%2' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'NOTIFICATION_TYPE',
                    options: [
                        [localize('Success'), 'success'],
                        [localize('Info'), 'info'],
                        [localize('Warn'), 'warn'],
                        [localize('Error'), 'error'],
                    ],
                },
                {
                    type: 'input_value',
                    name: 'MESSAGE',
                    check: ['String', 'Number'],
                },
            ],
            previousStatement: null,
            nextStatement: null,
            // Use fixed hues to avoid palette dependency during init
            colour: 200,
            colourSecondary: 210,
            colourTertiary: 220,
        });
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.btnotify = block => {
    const type = block.getFieldValue('NOTIFICATION_TYPE') || 'info';
    const message =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'MESSAGE',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_NONE
        ) || "''";
    return `Bot.notify('${type}', String(${message}));\n`;
};
