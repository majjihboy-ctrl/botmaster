const { generateBot, compileBot, MAX_ATTEMPTS } = require('../../../../api/_lib/pipeline');
const { normalizeSpec } = require('../../../../api/_lib/bot-spec');
const { validateBotXml } = require('../../../../api/_lib/validate-xml');
const { buildAdvancedXml } = require('../../../../api/_lib/advanced-bot');

const good = { strategy: 'even_odd', direction: 'even', initial_stake: 2, take_profit: 20, stop_loss: 10 };

const scripted = answers => {
    const calls = [];
    const ask = jest.fn(async (system, user) => {
        calls.push({ system, user });
        const next = answers.shift();
        if (next instanceof Error) throw next;
        return typeof next === 'string' ? next : JSON.stringify(next);
    });
    return { ask, calls };
};

describe('generateBot retry loop', () => {
    it('returns a valid bot on the first good answer', async () => {
        const { ask } = scripted([good]);
        const result = await generateBot({ description: 'even digits', ask });
        expect(result.errors).toEqual([]);
        expect(result.strategy).toBe('even_odd');
        expect(ask).toHaveBeenCalledTimes(1);
    });

    it('asks again when the answer is not JSON, and tells the model why', async () => {
        const { ask, calls } = scripted(['sorry, here you go: nothing', good]);
        const result = await generateBot({ description: 'even digits', ask });
        expect(result.strategy).toBe('even_odd');
        expect(calls[1].user).toContain('rejected');
        expect(calls[1].user).toContain('not valid JSON');
    });

    it('asks again when the strategy is unknown', async () => {
        const { ask, calls } = scripted([{ strategy: 'moon_shot' }, good]);
        const result = await generateBot({ description: 'x', ask });
        expect(result.strategy).toBe('even_odd');
        expect(calls[1].user).toContain('"strategy" must be one of');
    });

    it('gives up with a friendly error after the maximum attempts', async () => {
        const { ask } = scripted(Array(MAX_ATTEMPTS).fill({ strategy: 'moon_shot' }));
        await expect(generateBot({ description: 'x', ask })).rejects.toThrow(/couldn't produce a valid bot/);
        expect(ask).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    });

    it('lets a provider failure through immediately (nothing to retry)', async () => {
        const { ask } = scripted([new Error('No AI key set')]);
        await expect(generateBot({ description: 'x', ask })).rejects.toThrow('No AI key set');
        expect(ask).toHaveBeenCalledTimes(1);
    });

    it('refining: the current bot is part of the prompt and unchanged on failure', async () => {
        const previous = { ...normalizeSpec(good).spec };
        const { ask, calls } = scripted(Array(MAX_ATTEMPTS).fill('nonsense'));
        const result = await generateBot({ description: 'lower the stake', previous, ask });
        expect(calls[0].system).toContain('"initial_stake":2');
        expect(result.params.initial_stake).toBe(2);
        expect(result.notes[0]).toMatch(/unchanged/);
    });

    it('refining: applies the full updated answer', async () => {
        const previous = { ...normalizeSpec(good).spec };
        const { ask } = scripted([{ ...previous, initial_stake: 0.5, stake_mode: 'dalembert', stake_step: 0.25 }]);
        const result = await generateBot({ description: 'smaller stake, dalembert', previous, ask });
        expect(result.params.initial_stake).toBe(0.5);
        expect(result.params.stake_mode).toBe('dalembert');
    });
});

describe('compileBot', () => {
    it('keeps the legacy over_under_switch id working', () => {
        const result = compileBot({
            strategy: 'over_under_switch',
            base_legs: [
                { direction: 'under', digit: 7 },
                { direction: 'over', digit: 2 },
            ],
        });
        expect(result.errors).toEqual([]);
        expect(result.strategy).toBe('over_under');
    });

    it('builds an accumulator and checks its structure', () => {
        const result = compileBot({ strategy: 'accumulator', symbol: 'R_100', growth_rate: '0.03' });
        expect(result.errors).toEqual([]);
        expect(result.params.growth_rate).toBe('0.03');
    });

    it('explains every adjustment it makes', () => {
        const { notes, spec } = normalizeSpec({
            strategy: 'over_under',
            symbol: 'FAKE',
            direction: 'over',
            prediction: 9,
            duration_ticks: 99,
            initial_stake: 0.01,
            martingale_multiplier: 50,
        });
        expect(spec.base_legs[0].digit).toBe(8);
        expect(notes.join(' ')).toMatch(/Symbol "FAKE"/);
        expect(notes.join(' ')).toMatch(/digit 9/);
        expect(notes.join(' ')).toMatch(/minimum of \$0.35/);
        expect(notes.join(' ')).toMatch(/capped at x10/);
    });

    it('never lets model text into the XML', () => {
        const { spec } = normalizeSpec({ strategy: 'even_odd', symbol: '"><script>', direction: '<b>' });
        expect(buildAdvancedXml(spec)).not.toContain('<script>');
    });
});

describe('validateBotXml', () => {
    it('accepts a generated bot', () => {
        expect(validateBotXml(buildAdvancedXml(normalizeSpec(good).spec))).toEqual([]);
    });

    it('rejects broken or unsafe XML', () => {
        const xml = buildAdvancedXml(normalizeSpec(good).spec);
        expect(validateBotXml('not xml')).not.toEqual([]);
        expect(validateBotXml(xml.replace('</xml>', ''))).not.toEqual([]);
        expect(validateBotXml(xml.replace('type="purchase"', 'type="evil_block"'))[0]).toMatch(/Unknown block type/);
        expect(validateBotXml(xml.replace('DIGITEVEN</field></block>', 'DIGITODD</field></block>')).join(' ')).toMatch(
            /does not match/
        );
        expect(
            validateBotXml(xml.replace(/<field name="NUM">2<\/field>/, '<field name="NUM">NaN</field>')).join(' ')
        ).toMatch(/finite/);
    });
});
