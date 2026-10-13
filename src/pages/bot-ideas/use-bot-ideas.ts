import { useCallback, useEffect, useState } from 'react';

export type TIdeaStatus = 'idea' | 'testing' | 'working' | 'dropped';

export type TBotIdea = {
    id: string;
    title: string;
    market: string;
    strategy: string;
    status: TIdeaStatus;
    created_at: number;
    updated_at: number;
};

export type TIdeaDraft = Pick<TBotIdea, 'title' | 'market' | 'strategy' | 'status'>;

export const STATUSES: TIdeaStatus[] = ['idea', 'testing', 'working', 'dropped'];
export const LIMITS = { title: 80, market: 40, strategy: 2000, ideas: 200 };

const STORAGE_KEY = 'bm_bot_ideas_v1';

const isStatus = (value: unknown): value is TIdeaStatus => STATUSES.includes(value as TIdeaStatus);

/** Accepts only well-formed entries so a corrupted or hand-edited store can never crash the tab. */
const sanitize = (raw: unknown): TBotIdea[] => {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(
            (item): item is Record<string, unknown> =>
                typeof item === 'object' && item !== null && typeof (item as any).id === 'string'
        )
        .map(item => ({
            id: String(item.id),
            title: String(item.title ?? '').slice(0, LIMITS.title),
            market: String(item.market ?? '').slice(0, LIMITS.market),
            strategy: String(item.strategy ?? '').slice(0, LIMITS.strategy),
            status: isStatus(item.status) ? item.status : 'idea',
            created_at: Number(item.created_at) || Date.now(),
            updated_at: Number(item.updated_at) || Date.now(),
        }))
        .slice(0, LIMITS.ideas);
};

const load = (): TBotIdea[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? sanitize(JSON.parse(raw)) : [];
    } catch {
        return [];
    }
};

const newId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `idea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const useBotIdeas = () => {
    const [ideas, setIdeas] = useState<TBotIdea[]>(load);
    const [storage_ok, setStorageOk] = useState(true);

    // Persist on every change. If storage is blocked, say so instead of silently losing work.
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(ideas));
            setStorageOk(true);
        } catch {
            setStorageOk(false);
        }
    }, [ideas]);

    const addIdea = useCallback((draft: TIdeaDraft) => {
        const now = Date.now();
        setIdeas(prev => [{ ...draft, id: newId(), created_at: now, updated_at: now }, ...prev].slice(0, LIMITS.ideas));
    }, []);

    const updateIdea = useCallback((id: string, draft: Partial<TIdeaDraft>) => {
        setIdeas(prev => prev.map(idea => (idea.id === id ? { ...idea, ...draft, updated_at: Date.now() } : idea)));
    }, []);

    const deleteIdea = useCallback((id: string) => {
        setIdeas(prev => prev.filter(idea => idea.id !== id));
    }, []);

    return { ideas, addIdea, updateIdea, deleteIdea, storage_ok };
};
