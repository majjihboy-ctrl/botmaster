import type { ContractType } from './contract-analysis';

/** A bot the person can pick: one of this site's Free Bots (id = its file name, name = its title). */
export type TBotSummary = {
    id: string;
    name: string;
};

// Category names as the analysis tool groups contract types.
export const BOT_CATEGORY: Record<ContractType, string> = {
    over_under: 'Over/Under',
    odd_even: 'Even/Odd',
    rise_fall: 'Rise/Fall',
    match_differ: 'Matches/Differs',
    accumulator: 'Accumulators',
    multiplier: 'Multiplier',
};

// Bot names pre-assigned to specific sides, matched by exact name (ignoring case and
// punctuation). Empty on purpose: nothing is pre-selected, the person picks their own.
export const DEFAULT_BOT_NAMES: Record<string, string> = {};

export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export const CHOICES_STORAGE_KEY = 'epm_analysis_bot_choices_v2';

export const keyFor = (contractType: ContractType, side: string) => `${contractType}:${side}`;

export const readChoices = (): Record<string, string> => {
    try {
        return JSON.parse(window.localStorage.getItem(CHOICES_STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
};

export const writeChoices = (choices: Record<string, string>) => {
    try {
        window.localStorage.setItem(CHOICES_STORAGE_KEY, JSON.stringify(choices));
    } catch {
        // Storage unavailable -- the choice still works for this visit.
    }
};

/** The bot for a given side: the person's own saved pick if they made one, otherwise a name
 *  given for that exact side, otherwise none -- never guesses. */
export function resolveBot(
    bots: TBotSummary[],
    contractType: ContractType,
    side: string,
    choices: Record<string, string> = readChoices()
): TBotSummary | undefined {
    const savedId = choices[keyFor(contractType, side)];
    if (savedId) {
        const saved = bots.find(b => b.id === savedId);
        if (saved) return saved;
    }
    const name = DEFAULT_BOT_NAMES[keyFor(contractType, side)];
    if (!name) return undefined;
    return bots.find(b => normalize(b.name) === normalize(name));
}
