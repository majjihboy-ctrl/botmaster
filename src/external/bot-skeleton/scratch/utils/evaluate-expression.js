// Only plain arithmetic (digits, + - * / % ( ) . and spaces) may be evaluated. Anything else - names,
// calls, strings, brackets or semicolons - is rejected BEFORE it can reach new Function, so text that
// comes from a loaded or shared bot file can never run as code in the page.
const SAFE_ARITHMETIC = /^[\d\s+\-*/%().]+$/;
export const evaluateExpression = value => {
    if (!value || typeof value !== 'string' || value.length > 200) return 'invalid_input';
    const expression = value.trim();
    if (!SAFE_ARITHMETIC.test(expression)) return 'invalid_input';
    try {
        // eslint-disable-next-line no-new-func
        const result = new Function(`return ${expression}`)();
        return isNaN(result) ? 'invalid_input' : result;
    } catch (e) {
        return 'invalid_input';
    }
};
