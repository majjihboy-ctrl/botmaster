import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Localize, localize } from '@deriv-com/translations';
import { LegacyRefresh1pxIcon } from '@deriv/quill-icons/Legacy';
import { api_base } from '@/external/bot-skeleton';
import { getAuthInfo } from '@/external/deriv-core';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { useStore } from '@/hooks/useStore';
import './refresh-balance-button.scss';

type TStatus = 'idle' | 'loading' | 'success' | 'error';

const RefreshBalanceButton = observer(() => {
    const { client } = useStore() ?? {};
    const [is_open, setIsOpen] = useState(false);
    const [status, setStatus] = useState<TStatus>('idle');
    const [message, setMessage] = useState('');
    const popoverRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (is_open) document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [is_open]);

    // Only demo accounts can be topped up — Deriv's topup_virtual call
    // errors on real accounts. Guard sits after all hooks so hook order
    // never changes between renders.
    if (!client?.is_virtual) return null;

    const handleReset = async () => {
        if (status === 'loading') return;
        setStatus('loading');
        setMessage('');

        // This platform's Options API has no WebSocket topup_virtual call —
        // that's classic-API-only and this backend rejects it outright with
        // "Unrecognised request". Resetting a demo balance here only exists
        // as a REST endpoint, so it needs the OAuth access token + account id
        // rather than the WS connection.
        const auth_info = getAuthInfo();
        const account_id = localStorage.getItem('active_loginid');

        if (!auth_info?.access_token || !account_id) {
            setStatus('error');
            setMessage(localize('Not signed in — please log in and try again.'));
            return;
        }

        try {
            await DerivWSAccountsService.resetDemoBalance(auth_info.access_token, account_id);

            // The reset endpoint returns no body, so the WS balance call is
            // still needed to pull the actual new figure to display.
            let new_balance: number | undefined;
            if (api_base.api && api_base.api.connection?.readyState === 1) {
                const balance_res = await api_base.api.send({ balance: 1 });
                new_balance = balance_res?.balance?.balance;
            }

            if (typeof new_balance === 'number') {
                client.setBalance(new_balance.toString());
                setStatus('success');
                setMessage(localize('Balance reset to {{amount}}', { amount: new_balance.toLocaleString() }));
            } else {
                setStatus('success');
                setMessage(localize('Balance reset — refresh to see the new amount.'));
            }
        } catch (err: any) {
            setStatus('error');
            setMessage(err?.message || localize('Could not reset balance. Please try again.'));
        }
    };

    return (
        <div className='refresh-balance' ref={popoverRef}>
            <button
                className='refresh-balance__trigger'
                onClick={() => {
                    setIsOpen(o => !o);
                    if (!is_open) {
                        setStatus('idle');
                        setMessage('');
                    }
                }}
                aria-label={localize('Reset demo balance')}
                title={localize('Reset demo balance')}
            >
                <LegacyRefresh1pxIcon width={16} height={16} />
            </button>

            {is_open && (
                <div className='refresh-balance__popover'>
                    <p className='refresh-balance__title'>
                        <Localize i18n_default_text='Reset demo balance' />
                    </p>
                    <p className='refresh-balance__hint'>
                        <Localize i18n_default_text='Resets your demo balance back to the default $10,000.' />
                    </p>

                    {status === 'error' && <p className='refresh-balance__message error'>{message}</p>}
                    {status === 'success' && <p className='refresh-balance__message success'>{message}</p>}

                    <button
                        className={`refresh-balance__action ${status === 'loading' ? 'loading' : ''}`}
                        onClick={handleReset}
                        disabled={status === 'loading'}
                    >
                        {status === 'loading' ? (
                            <Localize i18n_default_text='Resetting…' />
                        ) : (
                            <Localize i18n_default_text='Reset now' />
                        )}
                    </button>
                </div>
            )}
        </div>
    );
});

export default RefreshBalanceButton;
