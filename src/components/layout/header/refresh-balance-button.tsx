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

    const handleResetBalance = async () => {
        if (!api || isLoading) return;

        setIsLoading(true);
        try {
            // Make API call to reset virtual account balance to 10,000
            const response = await api.send({ topup_virtual: 1 });
            
            if (response?.topup_virtual) {
                // Update client balance with new/reset balance
                client.setBalance(response.topup_virtual.toString());
                console.log('Demo balance reset to:', response.topup_virtual);
            }
        } catch (error) {
            console.error('Failed to reset demo balance:', error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Tooltip
            position='bottom'
            message={<Localize i18n_default_text='Reset demo balance to 10,000' />}
            alignment='center'
        >
            <button
                className={`refresh-balance-button ${isLoading ? 'refresh-balance-button--loading' : ''}`}
                onClick={handleResetBalance}
                disabled={isLoading}
                aria-label='Reset demo balance to 10,000'
                title='Reset demo balance to 10,000'
            >
                <LegacyRefresh1pxIcon width={16} height={16} />
            </button>
        </Tooltip>
    );
});

export default RefreshBalanceButton;
