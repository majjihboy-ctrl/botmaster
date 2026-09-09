import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Localize, localize } from '@deriv-com/translations';
import { LegacyRefresh1pxIcon } from '@deriv/quill-icons/Legacy';
import { api_base } from '@/external/bot-skeleton';
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

        // api_base.api is null until the socket connection is fully up —
        // calling .send on it directly throws and used to fall through to
        // a generic "Something went wrong" with no real explanation.
        if (!api_base.api || api_base.api.connection?.readyState !== 1) {
            setStatus('error');
            setMessage(localize('Not connected yet — wait a moment for the connection to come back and try again.'));
            return;
        }

        try {
            const topup_res = await api_base.api.send({ topup_virtual: 1 });

            if (topup_res?.error) {
                // Deriv only allows a top-up once the balance is genuinely
                // low — this is expected/documented behavior, not a bug.
                // Show Deriv's own message directly rather than guessing at
                // its exact error code.
                setStatus('error');
                setMessage(topup_res.error.message || localize('Could not reset balance. Please try again.'));
                return;
            }

            // topup_virtual's own response is just the top-up event details,
            // not the resulting balance — fetch the real current balance
            // right after so the figure shown is accurate.
            const balance_res = await api_base.api.send({ balance: 1 });
            const new_balance = balance_res?.balance?.balance;

            if (typeof new_balance === 'number') {
                client.setBalance(new_balance.toString());
                setStatus('success');
                setMessage(localize('Balance reset to {{amount}}', { amount: new_balance.toLocaleString() }));
            } else {
                setStatus('success');
                setMessage(localize('Balance topped up.'));
            }
        } catch (err: any) {
            // deriv-api rejects (rather than resolving with .error) on
            // connection-level failures, so the useful message can live at
            // err.error.message, err.message, or occasionally be absent
            // entirely (e.g. the socket dropped mid-request).
            setStatus('error');
            setMessage(
                err?.error?.message ||
                    err?.message ||
                    localize('Lost connection while resetting — please check your connection and try again.')
            );
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
                        <Localize i18n_default_text='Tops your demo balance back up. Only works once your balance has actually run low.' />
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
