import { isBlockedShortcut } from '../anti-inspect';

const ev = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
});

describe('isBlockedShortcut', () => {
    it.each([
        ['F12', {}],
        ['I', { ctrlKey: true, shiftKey: true }],
        ['j', { metaKey: true, shiftKey: true }],
        ['u', { ctrlKey: true }],
        ['i', { metaKey: true, altKey: true }],
    ])('blocks %s %j', (key, mods) => expect(isBlockedShortcut(ev(key, mods))).toBe(true));

    it.each([
        ['a', {}],
        ['c', { ctrlKey: true }],
        ['i', {}],
        ['F5', {}],
    ])('allows %s %j', (key, mods) => expect(isBlockedShortcut(ev(key, mods))).toBe(false));
});
