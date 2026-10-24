import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../../utils';

// Legacy block used by bots made for this site's previous platform. There it wrapped the stake and
// checked a licence for the HOST it carried. Bots from that platform are owned by this site, so the block
// is accepted here as a plain pass-through: the bot uses whatever stake is plugged into STAKE. It is
// deliberately not in the toolbox; it only exists so those bots can be imported and run unchanged.
window.Blockly.Blocks.utt_licence_lock = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Stake %1 %2'),
            args0: [
                {
                    type: 'field_input',
                    name: 'HOST',
                    text: '',
                    spellcheck: false,
                },
                {
                    type: 'input_value',
                    name: 'STAKE',
                    check: 'Number',
                },
            ],
            output: 'Number',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Uses the stake plugged into this block (imported from an older platform).'),
            category: window.Blockly.Categories.Miscellaneous,
        };
    },
    meta() {
        return {
            display_name: localize('Stake'),
            description: localize(
                'Imported from an older platform. This block passes the stake plugged into it straight through to your trade.'
            ),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.utt_licence_lock = block => {
    const { javascriptGenerator } = window.Blockly.JavaScript;
    // An empty STAKE yields 0, which Deriv rejects with a visible error, rather than a silent wrong stake.
    const stake = javascriptGenerator.valueToCode(block, 'STAKE', javascriptGenerator.ORDER_NONE) || '0';
    return [`(${stake})`, javascriptGenerator.ORDER_ATOMIC];
};
