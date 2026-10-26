import { localize } from '@deriv-com/translations';

// The same Virtual Hook under the names used by bots made for this site's previous platform
// (`virtual_hook_settings`, `virtual_hook_enabler`), so those bots import and use the real engine feature.
// Settings: identical fields, so the block definition and generator are shared with `vh_settings`.
window.Blockly.Blocks.virtual_hook_settings = window.Blockly.Blocks.vh_settings;
window.Blockly.JavaScript.javascriptGenerator.forBlock.virtual_hook_settings =
    window.Blockly.JavaScript.javascriptGenerator.forBlock.vh_settings;

// Enabler: same as `vh_toggle`, but the dropdown field is called VIRTUAL_HOOK_STATE.
window.Blockly.Blocks.virtual_hook_enabler = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            ...window.Blockly.Blocks.vh_toggle.definition(),
            message0: localize('Virtual Hook %1'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'VIRTUAL_HOOK_STATE',
                    options: [
                        [localize('enable'), 'enable'],
                        [localize('disable'), 'disable'],
                    ],
                },
            ],
        };
    },
    meta: window.Blockly.Blocks.vh_toggle.meta,
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.virtual_hook_enabler = block =>
    `Bot.enableVirtualHook(${block.getFieldValue('VIRTUAL_HOOK_STATE') === 'enable'});\n`;
