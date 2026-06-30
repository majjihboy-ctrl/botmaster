// Injects user-configured Stake/Take Profit/Stop Loss/Martingale and the
// trading symbol into a bot's XML DOM before it's loaded into the workspace.
//
// Targets blocks by their `field name="VAR"` (matched against the bot's own
// <variables> declaration, not a hardcoded id) and by `field
// name="SYMBOL_LIST"`, rather than blind text substitution — this is safe
// against id churn between bot files and fails loudly (logs a warning,
// leaves the bot's own default) if a bot doesn't declare a variable, instead
// of silently doing nothing.

export type TAutotradeParams = {
    stake: number;
    take_profit: number;
    stop_loss: number;
    martingale_size: number;
    symbol: string;
};

const findVariableId = (xmlDoc: Document, variable_name: string): string | null => {
    const variables = xmlDoc.querySelectorAll('variables > variable');
    for (const v of Array.from(variables)) {
        if (v.textContent?.trim() === variable_name) {
            return v.getAttribute('id');
        }
    }
    return null;
};

// Finds the `variables_set` block (within INITIALIZATION) for a given
// variable id, and sets its direct math_number child's NUM field.
const setInitNumberValue = (xmlDoc: Document, variable_id: string, value: number): boolean => {
    const fields = xmlDoc.querySelectorAll('field[name="VAR"]');
    for (const field of Array.from(fields)) {
        if (field.getAttribute('id') !== variable_id) continue;
        const block = field.closest('block[type="variables_set"]');
        if (!block) continue;
        const numField = block.querySelector(
            ':scope > value[name="VALUE"] > block[type="math_number"] > field[name="NUM"]'
        );
        if (numField) {
            numField.textContent = String(value);
            return true;
        }
    }
    return false;
};

const setSymbol = (xmlDoc: Document, symbol: string): boolean => {
    const field = xmlDoc.querySelector('field[name="SYMBOL_LIST"]');
    if (!field) return false;
    field.textContent = symbol;
    return true;
};

export const applyAutotradeParams = (xml_string: string, params: TAutotradeParams): string => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xml_string, 'text/xml');

    const warnings: string[] = [];

    const stake_id = findVariableId(xmlDoc, 'stake');
    if (!stake_id || !setInitNumberValue(xmlDoc, stake_id, params.stake)) {
        warnings.push('stake');
    }

    const tp_id = findVariableId(xmlDoc, 'take_profit');
    if (!tp_id || !setInitNumberValue(xmlDoc, tp_id, params.take_profit)) {
        warnings.push('take_profit');
    }

    const sl_id = findVariableId(xmlDoc, 'Stop_loss');
    if (!sl_id || !setInitNumberValue(xmlDoc, sl_id, params.stop_loss)) {
        warnings.push('stop_loss');
    }

    const ms_id = findVariableId(xmlDoc, 'martingale_size');
    if (!ms_id || !setInitNumberValue(xmlDoc, ms_id, params.martingale_size)) {
        warnings.push('martingale_size');
    }

    if (!setSymbol(xmlDoc, params.symbol)) {
        warnings.push('symbol');
    }

    if (warnings.length) {
        // eslint-disable-next-line no-console
        console.warn(
            `[autotrade] Could not set the following parameters (using the bot's own defaults instead): ${warnings.join(', ')}`
        );
    }

    return new XMLSerializer().serializeToString(xmlDoc);
};
