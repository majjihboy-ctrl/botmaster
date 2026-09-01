import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Localize } from '@deriv-com/translations';
import { Tooltip } from '@deriv-com/ui';
import { LegacyRefresh1pxIcon } from '@deriv/quill-icons/Legacy';
import { useStore } from '@/hooks/useStore';
import { useApiBase } from '@/hooks/useApiBase';
import './refresh-balance-button.scss';

const RefreshBalanceButton = observer(() => {
    const { client } = useStore() ?? {};
    const { api } = useApiBase();
    const [isLoading, setIsLoading] = useState(false);

    // Only show for demo/virtual accounts
    if (!client?.is_virtual) {
        return null;
    }

    const handleRefreshBalance = async () => {
        if (!api || isLoading) return;

        setIsLoading(true);
        try {
            // Make API call to refresh balance
            const response = await api.send({ balance: 1 });
            
            if (response?.balance) {
                client.setBalance(response.balance.toString());
                // Optional: Show success toast notification
                console.log('Balance refreshed:', response.balance);
            }
        } catch (error) {
            console.error('Failed to refresh balance:', error);
            // Optional: Show error notification
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Tooltip
            position='bottom'
            message={<Localize i18n_default_text='Refresh demo balance' />}
            alignment='center'
        >
            <button
                className={`refresh-balance-button ${isLoading ? 'refresh-balance-button--loading' : ''}`}
                onClick={handleRefreshBalance}
                disabled={isLoading}
                aria-label='Refresh demo balance'
            >
                <LegacyRefresh1pxIcon width={16} height={16} />
            </button>
        </Tooltip>
    );
});

export default RefreshBalanceButton;
