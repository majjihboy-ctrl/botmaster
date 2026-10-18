describe('execution mode', () => {
    beforeEach(() => {
        jest.resetModules();
        localStorage.clear();
    });

    it('defaults to normal and persists fast', () => {
        let mod = require('../run-mode');
        expect(mod.getExecutionMode()).toBe('normal');
        expect(mod.isFastExecution()).toBe(false);

        mod.setExecutionMode('fast');
        expect(mod.isFastExecution()).toBe(true);
        expect(localStorage.getItem('dbot_trade_execution_mode')).toBe('fast');

        jest.resetModules();
        mod = require('../run-mode');
        expect(mod.getExecutionMode()).toBe('fast');
    });

    it('ignores invalid values', () => {
        const mod = require('../run-mode');
        mod.setExecutionMode('turbo');
        expect(mod.getExecutionMode()).toBe('normal');
    });
});
