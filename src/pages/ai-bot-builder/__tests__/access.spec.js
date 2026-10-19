const mockFetch = jest.fn();
global.fetch = mockFetch;

const load = () => {
    jest.resetModules();
    return require('../../../../api/_lib/access');
};
const req = token => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });
const accounts = ids => ({ ok: true, json: async () => ({ data: ids.map(account_id => ({ account_id })) }) });
const TOKEN = 'a'.repeat(32);

describe('AI Bot Builder access', () => {
    beforeEach(() => {
        mockFetch.mockReset();
        delete process.env.AI_ALLOWED_ACCOUNTS;
    });

    it('needs a login token', async () => {
        const { checkAccess } = load();
        expect(await checkAccess(req())).toMatchObject({ ok: false, status: 401 });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects a token Deriv does not accept', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 401 });
        const { checkAccess } = load();
        expect(await checkAccess(req(TOKEN))).toMatchObject({ ok: false, status: 401 });
    });

    it('allows an account on the list (case-insensitive, any of the user accounts)', async () => {
        process.env.AI_ALLOWED_ACCOUNTS = ' cr123 , VRTC9 ';
        mockFetch.mockResolvedValue(accounts(['VRTC555', 'CR123']));
        const { checkAccess } = load();
        expect(await checkAccess(req(TOKEN))).toMatchObject({ ok: true });
    });

    it('blocks everyone else without revealing anything', async () => {
        process.env.AI_ALLOWED_ACCOUNTS = 'CR123';
        mockFetch.mockResolvedValue(accounts(['CR999']));
        const { checkAccess } = load();
        expect(await checkAccess(req(TOKEN))).toEqual({
            ok: false,
            status: 403,
            error: 'The AI Bot Builder is private.',
        });
    });

    it('is closed by default, and tells a verified user which account id to add', async () => {
        mockFetch.mockResolvedValue(accounts(['CR999']));
        const { checkAccess } = load();
        const result = await checkAccess(req(TOKEN));
        expect(result.status).toBe(403);
        expect(result.error).toContain('CR999');
    });

    it('sends the Deriv-App-ID header Deriv requires, and works with the new DOT… account ids', async () => {
        process.env.NEXT_PUBLIC_DERIV_APP_ID = 'APP123';
        process.env.AI_ALLOWED_ACCOUNTS = 'dot90004580';
        mockFetch.mockResolvedValue(accounts(['DOT90004580']));
        const { checkAccess } = load();
        expect(await checkAccess(req(TOKEN))).toMatchObject({ ok: true });
        expect(mockFetch.mock.calls[0][1].headers).toMatchObject({
            'Deriv-App-ID': 'APP123',
            Authorization: `Bearer ${TOKEN}`,
        });
        delete process.env.NEXT_PUBLIC_DERIV_APP_ID;
    });

    it('caches a verified token so Deriv is not called on every request', async () => {
        process.env.AI_ALLOWED_ACCOUNTS = 'CR123';
        mockFetch.mockResolvedValue(accounts(['CR123']));
        const { checkAccess } = load();
        await checkAccess(req(TOKEN));
        await checkAccess(req(TOKEN));
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('fails closed when Deriv cannot be reached', async () => {
        mockFetch.mockRejectedValue(new Error('network'));
        const { checkAccess } = load();
        expect(await checkAccess(req(TOKEN))).toMatchObject({ ok: false, status: 503 });
    });
});
