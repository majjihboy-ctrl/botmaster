// Static safety net run on every generated bot before it is sent to the browser. It cannot run Blockly
// (too heavy for a serverless function), so it checks the things that make a bot fail to load or buy:
// well-formed XML, the three required top-level blocks, only known block types, declared variables,
// finite numbers, a purchase that matches the trade definition, and a valid minimum stake.
// The builders themselves are tested against the real Blockly workspace (see ai-advanced-bots.spec.js).
//
// Plain CommonJS so Vercel's Node runtime never has to guess the module system.

const ALLOWED_BLOCKS = new Set([
    'trade_definition',
    'trade_definition_market',
    'trade_definition_tradetype',
    'trade_definition_contracttype',
    'trade_definition_candleinterval',
    'trade_definition_restartbuysell',
    'trade_definition_restartonerror',
    'trade_definition_tradeoptions',
    'before_purchase',
    'after_purchase',
    'purchase',
    'trade_again',
    'notify',
    'controls_if',
    'logic_compare',
    'logic_operation',
    'math_number',
    'math_number_positive',
    'math_arithmetic',
    'variables_get',
    'variables_set',
    'text',
    'contract_check_result',
    'total_profit',
    'total_runs',
    'last_digit',
    'last_digits_condition',
    'over_under_percent',
    'even_odd_percent',
    'check_direction',
    'tick',
    'ticks',
    'rsi_statement',
    'sma_statement',
    'ema_statement',
    'input_list',
    'period',
]);

const CONTRACTS = new Set([
    'CALL',
    'PUT',
    'DIGITEVEN',
    'DIGITODD',
    'DIGITOVER',
    'DIGITUNDER',
    'DIGITMATCH',
    'DIGITDIFF',
]);
const MIN_STAKE = 0.35;

function checkBalanced(xml, errors) {
    const stackTags = [];
    const tag = /<(\/?)([A-Za-z_][\w:.-]*)([^<>]*?)(\/?)>/g;
    let m;
    while ((m = tag.exec(xml))) {
        const [, closing, name, , selfClosing] = m;
        if (selfClosing) continue;
        if (closing) {
            if (stackTags.pop() !== name) {
                errors.push(`Mismatched closing tag </${name}>.`);
                return false;
            }
        } else {
            stackTags.push(name);
        }
    }
    if (stackTags.length) {
        errors.push(`Unclosed tag <${stackTags[stackTags.length - 1]}>.`);
        return false;
    }
    return true;
}

// Top-level blocks = <block> elements directly under <xml> (depth 1 after the <xml> root).
function topLevelBlockTypes(xml) {
    const types = [];
    const tag = /<(\/?)(block|shadow|xml|variables|variable|field|value|statement|next|mutation)\b([^<>]*?)(\/?)>/g;
    let depth = 0;
    let m;
    while ((m = tag.exec(xml))) {
        const [, closing, name, attrs, selfClosing] = m;
        if (closing) {
            depth -= 1;
            continue;
        }
        if (name === 'block' && depth === 1) {
            const t = /type="([^"]+)"/.exec(attrs);
            if (t) types.push(t[1]);
        }
        if (!selfClosing) depth += 1;
    }
    return types;
}

function validateBotXml(xml, { strict = true } = {}) {
    const errors = [];
    if (typeof xml !== 'string' || !xml.trim().startsWith('<xml')) return ['Bot XML must start with <xml>.'];
    if (!checkBalanced(xml, errors)) return errors;

    const top = topLevelBlockTypes(xml).sort();
    const expected = ['after_purchase', 'before_purchase', 'trade_definition'];
    // Generated strategies are exactly these three blocks; the accumulator reference template carries extra helpers.
    const missing = expected.filter(t => !top.includes(t));
    if (missing.length || (strict && top.length !== expected.length)) {
        errors.push(`Top-level blocks must be ${expected.join(', ')} (found ${top.join(', ') || 'none'}).`);
    }

    for (const m of xml.matchAll(/<field name="NUM">([^<]*)<\/field>/g)) {
        if (!Number.isFinite(Number(m[1]))) errors.push(`Number field is not a finite number: "${m[1]}".`);
    }
    if (!strict) return errors;

    const types = new Set([...xml.matchAll(/<(?:block|shadow) [^>]*type="([^"]+)"/g)].map(m => m[1]));
    for (const t of types) if (!ALLOWED_BLOCKS.has(t)) errors.push(`Unknown block type "${t}".`);

    const declared = new Set([...xml.matchAll(/<variable id="([^"]+)">/g)].map(m => m[1]));
    for (const m of xml.matchAll(/<field name="VAR" id="([^"]+)">/g)) {
        if (!declared.has(m[1])) errors.push(`Variable ${m[1]} is used but not declared.`);
    }

    const typeList = /<field name="TYPE_LIST">([^<]*)<\/field>/.exec(xml);
    const purchases = [...xml.matchAll(/<field name="PURCHASE_LIST">([^<]*)<\/field>/g)].map(m => m[1]);
    if (purchases.length === 0) errors.push('The bot never purchases a contract.');
    for (const p of purchases) {
        if (!CONTRACTS.has(p)) errors.push(`Unknown contract type "${p}".`);
        if (typeList && typeList[1] !== 'both' && typeList[1] !== p) {
            errors.push(`Purchase ${p} does not match the trade definition (${typeList[1]}).`);
        }
    }

    const hasPredictionMutation = /has_prediction="true"/.test(xml);
    const hasPredictionValue = /<value name="PREDICTION">/.test(xml);
    if (hasPredictionMutation !== hasPredictionValue) errors.push('Prediction setting and barrier digit do not match.');

    const stake = /<value name="AMOUNT"><shadow type="math_number_positive"><field name="NUM">([^<]*)<\/field>/.exec(
        xml
    );
    if (!stake || Number(stake[1]) < MIN_STAKE) errors.push(`Initial stake must be at least ${MIN_STAKE}.`);

    return errors;
}

module.exports = { validateBotXml, ALLOWED_BLOCKS };
