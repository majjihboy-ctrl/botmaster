/*
 Defines a simple math_minmax block compatible with common DBot XMLs
 It outputs either MIN(A,B) or MAX(A,B)
*/

// Ensure Blockly is available globally per existing pattern in blockly.js
window.Blockly.Blocks.math_minmax = {
    init: function () {
        this.jsonInit({
            type: 'math_minmax',
            message0: '%1 of %2 and %3',
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'OP',
                    options: [
                        ['MIN', 'MIN'],
                        ['MAX', 'MAX'],
                    ],
                },
                {
                    type: 'input_value',
                    name: 'A',
                    check: 'Number',
                },
                {
                    type: 'input_value',
                    name: 'B',
                    check: 'Number',
                },
            ],
            inputsInline: true,
            output: 'Number',
            colour: 230,
            tooltip: 'Returns the min or max of two numbers',
            helpUrl: '',
        });
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.math_minmax = function (block) {
    const op = block.getFieldValue('OP') || 'MIN';
    const a = window.Blockly.JavaScript.valueToCode(block, 'A', window.Blockly.JavaScript.ORDER_NONE) || '0';
    const b = window.Blockly.JavaScript.valueToCode(block, 'B', window.Blockly.JavaScript.ORDER_NONE) || '0';
    const code = op === 'MAX' ? `Math.max(${a}, ${b})` : `Math.min(${a}, ${b})`;
    return [code, window.Blockly.JavaScript.ORDER_FUNCTION_CALL];
};
