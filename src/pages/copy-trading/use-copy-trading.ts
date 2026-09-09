import { useCallback, useEffect, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';

const STORAGE_KEY = 'copy_trading_remembered';

// Deriv's copy_stop call needs the SAME token that was used to start
// copying — there's no server-side lookup by relationship. We remember a
// nickname + token pair locally (this browser only) purely so Stop can be
// issued later without re-pasting the token. Never sent anywhere except
// back to Deriv's own API when the person clicks Stop.
export type TRememberedTrader = { nickname: string; token: string; started_at: number };

const loadRemembered = (): TRememberedTrader[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
};

const saveRemembered = (list: TRememberedTrader[]) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
        // non-fatal
    }
};

export type TCopyStartParams = {
    token: string;
    nickname: string;
    assets?: string[];
    trade_types?: string[];
    min_trade_stake?: number;
    max_trade_stake?: number;
};

export const useCopyTrading = () => {
    const [remembered, setRemembered] = useState<TRememberedTrader[]>(() => loadRemembered());
    const [copy_list, setCopyList] = useState<any>(null);
    const [list_loading, setListLoading] = useState(false);
    const [list_error, setListError] = useState('');

    const refreshList = useCallback(async () => {
        setListLoading(true);
        setListError('');
        try {
            const res = await api_base.api.send({ copytrading_list: 1 });
            if (res?.error) {
                setListError(res.error.message || 'Could not load copy trading list.');
                setCopyList(null);
            } else {
                setCopyList(res?.copytrading_list ?? null);
            }
        } catch (err: any) {
            setListError(err?.message || 'Could not load copy trading list.');
        } finally {
            setListLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshList();
    }, [refreshList]);

    const startCopying = useCallback(async (params: TCopyStartParams) => {
        const res = await api_base.api.send({
            copy_start: params.token,
            ...(params.assets?.length ? { assets: params.assets } : {}),
            ...(params.trade_types?.length ? { trade_types: params.trade_types } : {}),
            ...(typeof params.min_trade_stake === 'number' ? { min_trade_stake: params.min_trade_stake } : {}),
            ...(typeof params.max_trade_stake === 'number' ? { max_trade_stake: params.max_trade_stake } : {}),
        });

        if (res?.error) {
            return { success: false, message: res.error.message || 'Could not start copying.' };
        }

        const next = [
            ...remembered.filter(r => r.token !== params.token),
            { nickname: params.nickname || 'Unnamed trader', token: params.token, started_at: Date.now() },
        ];
        setRemembered(next);
        saveRemembered(next);
        await refreshList();
        return { success: true, message: 'Now copying this trader.' };
    }, [remembered, refreshList]);

    const stopCopying = useCallback(async (token: string) => {
        const res = await api_base.api.send({ copy_stop: token });
        if (res?.error) {
            return { success: false, message: res.error.message || 'Could not stop copying.' };
        }
        const next = remembered.filter(r => r.token !== token);
        setRemembered(next);
        saveRemembered(next);
        await refreshList();
        return { success: true, message: 'Stopped copying.' };
    }, [remembered, refreshList]);

    const forgetRemembered = useCallback((token: string) => {
        const next = remembered.filter(r => r.token !== token);
        setRemembered(next);
        saveRemembered(next);
    }, [remembered]);

    const lookupStatistics = useCallback(async (trader_id: string) => {
        try {
            const res = await api_base.api.send({ copytrading_statistics: 1, trader_id });
            if (res?.error) {
                return { success: false, message: res.error.message || 'Could not fetch trader statistics.', data: null };
            }
            return { success: true, message: '', data: res?.copytrading_statistics ?? null };
        } catch (err: any) {
            return { success: false, message: err?.message || 'Could not fetch trader statistics.', data: null };
        }
    }, []);

    return {
        remembered,
        copy_list,
        list_loading,
        list_error,
        refreshList,
        startCopying,
        stopCopying,
        forgetRemembered,
        lookupStatistics,
    };
};
