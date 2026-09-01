import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.check_percentage_match = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: '%1 %2 %% of last %3 ticks',
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'CONTRACT_TYPE',
                    options: [
                        ['Rise', 'rise'],
                        ['Fall', 'fall'],
                        ['Even', 'even'],
                        ['Odd', 'odd'],
                        ['Over 4', 'over4'],
                        ['Under 5', 'under5'],
                    ],
                },
                {
                    type: 'field_number',
                    name: 'PERCENTAGE',
                    value: 1000,
                },
                {
                    type: 'field_number',
                    name: 'TICK_COUNT',
                    value: 100,
                },
            ],
            output: 'Boolean',
            colour: '#5b67ca',
        };
    },
    meta() {
        return {
            display_name: localize('Check % Match Last Ticks'),
            description: localize('Check percentage of ticks matching contract type'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.check_percentage_match = (block) => {
    const contractType = block.getFieldValue('CONTRACT_TYPE');
    const percentage = block.getFieldValue('PERCENTAGE');
    const tickCount = block.getFieldValue('TICK_COUNT');
    const code = `Bot.checkPercentageMatch('${contractType}', ${percentage}, ${tickCount})`;
    return [code, window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC];
};
