import { act, renderHook } from '@testing-library/react';
import { useBotIdeas } from '../use-bot-ideas';

const KEY = 'bm_bot_ideas_v1';
const draft = { title: 'Over 2 recovery', market: 'Vol 100', strategy: 'Wait for three unders then enter over 2.', status: 'idea' as const };

describe('useBotIdeas', () => {
    beforeEach(() => localStorage.clear());

    it('adds, edits and deletes ideas and persists them', () => {
        const { result } = renderHook(() => useBotIdeas());
        expect(result.current.ideas).toEqual([]);

        act(() => result.current.addIdea(draft));
        expect(result.current.ideas).toHaveLength(1);
        const { id } = result.current.ideas[0];
        expect(JSON.parse(localStorage.getItem(KEY) as string)[0].title).toBe('Over 2 recovery');

        act(() => result.current.updateIdea(id, { status: 'testing' }));
        expect(result.current.ideas[0].status).toBe('testing');

        act(() => result.current.deleteIdea(id));
        expect(result.current.ideas).toHaveLength(0);
    });

    it('puts the newest idea first', () => {
        const { result } = renderHook(() => useBotIdeas());
        act(() => result.current.addIdea({ ...draft, title: 'first' }));
        act(() => result.current.addIdea({ ...draft, title: 'second' }));
        expect(result.current.ideas.map(i => i.title)).toEqual(['second', 'first']);
    });

    it('survives corrupted or hand-edited storage', () => {
        localStorage.setItem(KEY, '{not json');
        expect(renderHook(() => useBotIdeas()).result.current.ideas).toEqual([]);

        localStorage.setItem(KEY, JSON.stringify([{ id: 'a', title: 'ok', status: 'bogus' }, null, 'x', { title: 'no id' }]));
        const { result } = renderHook(() => useBotIdeas());
        expect(result.current.ideas).toHaveLength(1);
        expect(result.current.ideas[0].status).toBe('idea'); // unknown status falls back safely
    });

    it('reports when storage is blocked instead of failing silently', () => {
        const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const { result } = renderHook(() => useBotIdeas());
        expect(result.current.storage_ok).toBe(false);
        spy.mockRestore();
    });
});
