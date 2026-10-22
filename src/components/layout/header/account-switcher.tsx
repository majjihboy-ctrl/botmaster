import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { addComma, getCurrencyDisplayCode, getDecimalPlaces, standalone_routes } from '@/components/shared';
import { CurrencyIcon } from '@/components/currency/currency-icon';
import Text from '@/components/shared_ui/text';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { isDemoAccount } from '@/utils/account-helpers';
import { Localize } from '@deriv-com/translations';
import { TAccountSwitcher } from './common/types';
import AccountInfoWrapper from './account-info-wrapper';
import './account-switcher.scss';

const AccountSwitcher = observer(({ activeAccount }: TAccountSwitcher) => {
    const [isOpen, setIsOpen] = useState(false);
    const [activeCategory, setActiveCategory] = useState<'real' | 'demo'>('real');
    const [isResetting, setIsResetting] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const { accountList, activeLoginid } = useApiBase();
    const { client, run_panel } = useStore() ?? {};

    const is_bot_running = run_panel?.is_running || api_base.is_running;
    const isSingleAccount = !accountList || accountList.length <= 1;

    // Open on the tab of the account that is active right now.
    useEffect(() => {
        setActiveCategory(activeAccount?.isVirtual ? 'demo' : 'real');
    }, [activeAccount?.isVirtual, isOpen]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const toggleDropdown = useCallback(() => {
        if (is_bot_running || isSingleAccount) return;
        setIsOpen(prev => !prev);
    }, [is_bot_running, isSingleAccount]);

    const handleResetBalance = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsResetting(true);
        try {
            // The balance subscription set up in api-base pushes the new amount, no refetch needed.
            await api_base.api?.send({ topup_virtual: 1 });
        } catch (err) {
            console.error('Failed to reset demo balance:', err);
        } finally {
            setIsResetting(false);
        }
    }, []);

    const handleAccountSelect = useCallback(
        (loginid: string) => {
            localStorage.setItem('active_loginid', loginid);
            client?.checkAndRegenerateWebSocket();
            setIsOpen(false);
        },
        [client]
    );

    const formattedAccounts = useMemo(() => {
        if (!accountList) return [];
        return accountList
            .map(account => ({
                loginid: account.loginid,
                currency: account.currency,
                balance: addComma(Number(account.balance ?? 0).toFixed(getDecimalPlaces(account.currency))),
                isVirtual: isDemoAccount(account.loginid),
                isActive: account.loginid === activeLoginid,
            }))
            .sort((a, b) => (a.isActive ? -1 : b.isActive ? 1 : 0));
    }, [accountList, activeLoginid]);

    const categoryAccounts = formattedAccounts.filter(account => account.isVirtual === (activeCategory === 'demo'));

    if (!activeAccount) return null;

    const { currency, isVirtual, balance } = activeAccount;
    const showChevron = !isSingleAccount && !is_bot_running;

    return (
        <div className='acc-info__wrapper' ref={wrapperRef}>
            <AccountInfoWrapper>
                <div
                    data-testid='dt_acc_info'
                    id='dt_core_account-info_acc-info'
                    role={showChevron ? 'button' : undefined}
                    tabIndex={showChevron ? 0 : -1}
                    aria-expanded={showChevron ? isOpen : undefined}
                    aria-haspopup={showChevron ? 'listbox' : undefined}
                    className={classNames('acc-info', {
                        'acc-info--is-virtual': isVirtual,
                        'acc-info--interactive': showChevron,
                    })}
                    onClick={toggleDropdown}
                    onKeyDown={e => {
                        if (showChevron && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            toggleDropdown();
                        }
                    }}
                >
                    <span className='acc-info__id' aria-hidden='true'>
                        <CurrencyIcon currency={currency} isVirtual={isVirtual} />
                    </span>
                    <div className='acc-info__content'>
                        <div className='acc-info__account-type-header'>
                            <Text as='p' size='xs' className='acc-info__account-type'>
                                {isVirtual ? (
                                    <Localize i18n_default_text='Demo account' />
                                ) : (
                                    <Localize i18n_default_text='Real account' />
                                )}
                            </Text>
                            {showChevron && (
                                <span
                                    className={classNames('acc-info__select-arrow', {
                                        'acc-info__select-arrow--invert': isOpen,
                                    })}
                                >
                                    <svg width='12' height='12' viewBox='0 0 12 12' fill='none'>
                                        <path
                                            d='M2 4L6 8L10 4'
                                            stroke='currentColor'
                                            strokeWidth='1.5'
                                            strokeLinecap='round'
                                            strokeLinejoin='round'
                                        />
                                    </svg>
                                </span>
                            )}
                        </div>
                        {(typeof balance !== 'undefined' || !currency) && (
                            <div className='acc-info__balance-section'>
                                <p
                                    data-testid='dt_balance'
                                    className={classNames('acc-info__balance', {
                                        'acc-info__balance--no-currency': !currency && !isVirtual,
                                    })}
                                >
                                    {!currency ? (
                                        <Localize i18n_default_text='No currency assigned' />
                                    ) : (
                                        `${balance} ${getCurrencyDisplayCode(currency)}`
                                    )}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </AccountInfoWrapper>
            {isOpen && (
                <div className='acc-dropdown acc-dropdown--panel' role='listbox'>
                    <div className='acc-dropdown__tabs' role='tablist'>
                        {(['real', 'demo'] as const).map(category => (
                            <button
                                key={category}
                                type='button'
                                role='tab'
                                aria-selected={activeCategory === category}
                                className={classNames('acc-dropdown__tab', {
                                    'acc-dropdown__tab--active': activeCategory === category,
                                })}
                                onClick={() => setActiveCategory(category)}
                            >
                                {category === 'real' ? (
                                    <Localize i18n_default_text='Real' />
                                ) : (
                                    <Localize i18n_default_text='Demo' />
                                )}
                            </button>
                        ))}
                    </div>

                    <div className='acc-dropdown__section-header'>
                        <Localize i18n_default_text='Deriv account' />
                    </div>

                    <div className='acc-dropdown__list'>
                        {categoryAccounts.length === 0 && (
                            <div className='acc-dropdown__empty'>
                                {activeCategory === 'demo' ? (
                                    <Localize i18n_default_text='No demo account found.' />
                                ) : (
                                    <Localize i18n_default_text='No real account found.' />
                                )}
                            </div>
                        )}
                        {categoryAccounts.map(account => (
                            <div
                                key={account.loginid}
                                role='option'
                                aria-selected={account.isActive}
                                tabIndex={0}
                                className={classNames('acc-dropdown__account', {
                                    'acc-dropdown__account--selected': account.isActive,
                                    'acc-dropdown__account--virtual': account.isVirtual,
                                })}
                                onClick={() => !account.isActive && handleAccountSelect(account.loginid)}
                                onKeyDown={e => {
                                    if (!account.isActive && (e.key === 'Enter' || e.key === ' ')) {
                                        e.preventDefault();
                                        handleAccountSelect(account.loginid);
                                    }
                                }}
                            >
                                <div className='acc-dropdown__account-left'>
                                    <CurrencyIcon currency={account.currency} isVirtual={account.isVirtual} />
                                    <div>
                                        <Text
                                            size='xxxs'
                                            className={classNames('acc-dropdown__account-type', {
                                                'acc-dropdown__account-type--virtual': account.isVirtual,
                                            })}
                                        >
                                            {account.isVirtual ? (
                                                <Localize i18n_default_text='Demo account' />
                                            ) : (
                                                <Localize i18n_default_text='Real account' />
                                            )}
                                        </Text>
                                        <div className='acc-dropdown__account-id'>{account.loginid}</div>
                                    </div>
                                </div>
                                {activeCategory === 'demo' && account.isActive ? (
                                    <button
                                        type='button'
                                        className='acc-dropdown__reset-btn'
                                        disabled={isResetting}
                                        onClick={handleResetBalance}
                                    >
                                        {isResetting ? (
                                            <Localize i18n_default_text='Resetting...' />
                                        ) : (
                                            <Localize i18n_default_text='Reset balance' />
                                        )}
                                    </button>
                                ) : (
                                    <Text size='xs' weight='bold' className='acc-dropdown__balance'>
                                        {account.currency ? (
                                            `${account.balance} ${getCurrencyDisplayCode(account.currency)}`
                                        ) : (
                                            <Localize i18n_default_text='No currency assigned' />
                                        )}
                                    </Text>
                                )}
                            </div>
                        ))}
                    </div>

                    <a
                        href={standalone_routes.traders_hub}
                        className='acc-dropdown__cfd-link'
                        onClick={() => setIsOpen(false)}
                    >
                        <Localize i18n_default_text="Looking for CFD accounts? Go to Trader's Hub" />
                    </a>

                    <div className='acc-dropdown__footer'>
                        <a href={standalone_routes.traders_hub} className='acc-dropdown__manage-btn'>
                            <Localize i18n_default_text='Manage accounts' />
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
});

export default AccountSwitcher;
