import { localize } from '@deriv-com/translations';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.apollo_purchase = {
    init() {
        this.jsonInit(this.definition());
        // Ensure one of this type per statement-stack
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Apollo Purchase {{ contract_type }}', { contract_type: '%1' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PURCHASE_LIST',
                    options: [['', '']],
                },
            ],
            message1: localize('Multiple contracts: %1'),
            args1: [
                {
                    type: 'field_dropdown',
                    name: 'MULTIPLE_CONTRACTS',
                    options: [
                        [localize('False'), 'FALSE'],
                        [localize('True'), 'TRUE'],
                    ],
                },
            ],
            message2: localize('Contract quantity: %1'),
            args2: [
                {
                    type: 'field_number',
                    name: 'CONTRACT_QUANTITY',
                    value: 1,
                    min: 1,
                    max: 10,
                },
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('This block purchases contract of a specified type with advanced options.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Apollo Purchase'),
            description: localize(
                'Use this block to purchase the specific contract you want with advanced options. You may add multiple Purchase blocks together with conditional blocks to define your purchase conditions. This block can only be used within the Purchase conditions block.'
            ),
            key_words: localize('buy, apollo'),
        };
    },
    onchange: window.Blockly.Blocks.purchase.onchange,
    populatePurchaseList: window.Blockly.Blocks.purchase.populatePurchaseList,
    enforceLimitations: window.Blockly.Blocks.purchase.enforceLimitations,
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    restricted_parents: ['before_purchase'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.apollo_purchase = block => {
    const purchaseList = block.getFieldValue('PURCHASE_LIST');
    const multipleContracts = block.getFieldValue('MULTIPLE_CONTRACTS');
    const contractQuantity = block.getFieldValue('CONTRACT_QUANTITY');

    // Generate code that behaves like standard purchase but with additional options
    let code = `Bot.purchase('${purchaseList}');\n`;

    // Add logging for the additional options
    if (multipleContracts === 'TRUE' && contractQuantity > 1) {
        code = `// Apollo Purchase: Multiple contracts (${contractQuantity})\n` + code;
        // For now, we'll just purchase once but log the intent
        // In a full implementation, this could loop or use different logic
    }

    return code;
};

// Apollo Purchase 2 - Simplified version
window.Blockly.Blocks.apollo_purchase2 = {
    init() {
        this.jsonInit(this.definition());
        // Ensure one of this type per statement-stack
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Apollo Purchase 2 {{ contract_type }}', { contract_type: '%1' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PURCHASE_LIST',
                    options: [['', '']],
                },
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('This block purchases contract of a specified type (simplified version).'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Apollo Purchase 2'),
            description: localize(
                'Use this block to purchase the specific contract you want (simplified version). This block can only be used within the Purchase conditions block.'
            ),
            key_words: localize('buy, apollo'),
        };
    },
    onchange: window.Blockly.Blocks.purchase.onchange,
    populatePurchaseList: window.Blockly.Blocks.purchase.populatePurchaseList,
    enforceLimitations: window.Blockly.Blocks.purchase.enforceLimitations,
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    restricted_parents: ['before_purchase'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.apollo_purchase2 = block => {
    const purchaseList = block.getFieldValue('PURCHASE_LIST');
    const code = `Bot.purchase('${purchaseList}');\n`;
    return code;
};
