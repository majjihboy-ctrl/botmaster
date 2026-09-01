import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

/**
 * Block: Check if percentage of last ticks match a contract type
 * Similar to blocks on binarytool.site
 * Example: "Rise 1000 % of last 100 ticks"
 */
window.Blockly.Blocks.check_percentage_match = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            type: 'check_percentage_match',
            message0: '%1 %2 %% of last %3 ticks',
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'CONTRACT_TYPE',
                    options: [
                        [localize('Rise'), 'rise'],
                        [localize('Fall'), 'fall'],
                        [localize('Even'), 'even'],
                        [localize('Odd'), 'odd'],
                        [localize('Over 4'), 'over4'],
                        [localize('Under 5'), 'under5'],
                    ],
                },
                {
                    type: 'field_number',
                    name: 'PERCENTAGE',
                    value: 1000,
                    min: 1,
                },
                {
                    type: 'field_number',
                    name: 'TICK_COUNT',
                    value: 100,
                    min: 1,
                },
            ],
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize(
                'Check if the last N ticks match the contract type for at least X% of the time'
            ),
        };
    },
    meta() {
        return {
            display_name: localize('Check % Match Last Ticks'),
            description: localize(
                'Returns true if at least the specified percentage of the last ticks match the contract type (e.g., Rise, Fall, Even, Odd).'
            ),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

/**
 * Code generator for check_percentage_match block
 * Produces: Bot.checkPercentageMatch('rise', 1000, 100)
 */
window.Blockly.JavaScript.javascriptGenerator.forBlock.check_percentage_match = (block) => {
    const contractType = block.getFieldValue('CONTRACT_TYPE');
    const percentage = block.getFieldValue('PERCENTAGE');
    const tickCount = block.getFieldValue('TICK_COUNT');

    const code = `Bot.checkPercentageMatch('${contractType}', ${percentage}, ${tickCount})`;

    return [code, window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC];
};
