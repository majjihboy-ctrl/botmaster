// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import ContentLoader from 'react-content-loader';
import Money from '@/components/shared_ui/money';
import { TContractInfo } from '@/components/summary/summary-card.types';
import { popover_zindex } from '@/constants/z-indexes';
import { getContractTypeName } from '@/external/bot-skeleton';
import { isDbotRTL } from '@/external/bot-skeleton/utils/workspace';
import { getSymbolDisplayNameSync } from '@/utils/symbol-display-name';
import { LegacyRadioOffIcon, LegacyRadioOnIcon } from '@deriv/quill-icons';
import { Localize, localize } from '@deriv-com/translations';
import { MarketIcon } from '../market/market-icon';
import { convertDateFormat } from '../shared';
import Popover from '../shared_ui/popover';
import { TradeTypeIcon } from '../trade-type/trade-type-icon';

type TTransactionIconWithText = {
    icon: React.ReactElement;
    title: string;
    message?: React.ReactNode;
    className?: string;
};

type TPopoverItem = {
    icon?: React.ReactElement;
    title: string;
    children: React.ReactNode;
};

type TPopoverContent = {
    contract: TContractInfo;
};

type TTransaction = {
    contract?: TContractInfo | null;
    onClickTransaction?: (transaction_id: null | number) => void;
    active_transaction_id?: number | null;
};

/** Extract the last digit from a spot/price value for clear display */
const getExitDigit = (spot: string | number | undefined | null): string | null => {
    if (spot === undefined || spot === null || spot === '') return null;
    const str = String(spot);
    // Take the last character that is a digit
    for (let i = str.length - 1; i >= 0; i--) {
        if (/\d/.test(str[i])) return str[i];
    }
    return null;
};

const TransactionIconWithText = ({ icon, title, message, className }: TTransactionIconWithText) => (
    <React.Fragment>
        <Popover
            className={classNames(className, 'transactions__icon')}
            alignment={isDbotRTL() ? 'right' : 'left'}
            message={title}
            zIndex={popover_zindex.TRANSACTION.toString()}
        >
            {icon}
        </Popover>
        {message}
    </React.Fragment>
);

const TransactionFieldLoader = () => (
    <ContentLoader
        className='transactions__loader-text'
        height={10}
        width={80}
        speed={3}
        backgroundColor={'var(--general-section-2)'}
        foregroundColor={'var(--general-hover)'}
    >
        <rect x='0' y='0' rx='0' ry='0' width='100' height='12' />
    </ContentLoader>
);

const TransactionIconLoader = () => (
    <ContentLoader
        className='transactions__loader-icon'
        speed={3}
        width={24}
        height={24}
        backgroundColor={'var(--general-section-1)'}
        foregroundColor={'var(--general-hover)'}
    >
        <rect x='0' y='0' rx='4' ry='4' width='24' height='24' />
    </ContentLoader>
);

const PopoverItem = ({ icon, title, children }: TPopoverItem) => (
    <div className='transactions__popover-item'>
        {icon && <div className='transaction__popover-icon'>{icon}</div>}
        <div className='transactions__popover-details'>
            <div className='transactions__popover-title'>{title}</div>
            {children}
        </div>
    </div>
);

const PopoverContent = ({ contract }: TPopoverContent) => {
    const exit_digit = getExitDigit(contract.exit_spot);

    return (
        <div className='transactions__popover-content'>
            {contract.transaction_ids && (
                <PopoverItem title={<Localize i18n_default_text='Reference IDs' />}>
                    {contract.transaction_ids.buy && (
                        <div className='transactions__popover-value'>
                            {`${contract.transaction_ids.buy} ${localize('(Buy)')}`}
                        </div>
                    )}
                    {contract.transaction_ids.sell && (
                        <div className='transactions__popover-value'>
                            {`${contract.transaction_ids.sell} ${localize('(Sell)')}`}
                        </div>
                    )}
                </PopoverItem>
            )}
            {contract.tick_count && (
                <PopoverItem title={localize('Duration')}>
                    <div className='transactions__popover-value'>{`${contract.tick_count} ${localize('ticks')}`}</div>
                </PopoverItem>
            )}
            {(contract.barrier && (
                <PopoverItem title={localize('Barrier')}>
                    <div className='transactions__popover-value'>{contract.barrier}</div>
                </PopoverItem>
            )) ||
                (contract.high_barrier && contract.low_barrier && (
                    <PopoverItem title={localize('Barriers')}>
                        <div className='transactions__popover-value'>{`${contract.high_barrier} ${localize(
                            '(High)'
                        )}`}</div>
                        <div className='transactions__popover-value'>{`${contract.low_barrier} ${localize('(Low)')}`}</div>
                    </PopoverItem>
                ))}
            {contract.date_start && (
                <PopoverItem title={localize('Start time')}>
                    <div className='transactions__popover-value'>
                        {convertDateFormat(contract.date_start, 'YYYY-M-D HH:mm:ss [GMT]', 'YYYY-MM-DD HH:mm:ss [GMT]')}
                    </div>
                </PopoverItem>
            )}
            {contract.entry_spot && (
                <PopoverItem title={localize('Entry spot')}>
                    <div className='transactions__popover-value'>{contract.entry_spot}</div>
                    {contract.entry_tick_time && (
                        <div className='transactions__popover-value'>
                            {convertDateFormat(
                                contract.entry_tick_time,
                                'YYYY-M-D HH:mm:ss [GMT]',
                                'YYYY-MM-DD HH:mm:ss [GMT]'
                            )}
                        </div>
                    )}
                </PopoverItem>
            )}
            {(contract.exit_spot && contract.exit_tick_time && (
                <PopoverItem title={localize('Exit spot')}>
                    <div className='transactions__popover-value'>{contract.exit_spot}</div>
                    <div className='transactions__popover-value'>
                        {convertDateFormat(contract.exit_tick_time, 'YYYY-M-D HH:mm:ss [GMT]', 'YYYY-MM-DD HH:mm:ss [GMT]')}
                    </div>
                </PopoverItem>
            )) ||
                (contract.exit_spot && (
                    <PopoverItem title={localize('Exit time')}>
                        <div className='transactions__popover-value'>{contract.exit_spot}</div>
                    </PopoverItem>
                ))}

            {/* Clear resulting digit for digit trades / clarity */}
            {exit_digit !== null && (
                <PopoverItem title={localize('Exit Digit')}>
                    <div
                        className='transactions__popover-value'
                        style={{
                            fontSize: '1.4em',
                            fontWeight: 'bold',
                            color: 'var(--text-prominent)',
                            letterSpacing: '0.05em',
                        }}
                    >
                        {exit_digit}
                    </div>
                </PopoverItem>
            )}
        </div>
    );
};

const Transaction = ({ contract, active_transaction_id, onClickTransaction }: TTransaction) => {
    const exit_digit = contract ? getExitDigit(contract.exit_spot) : null;

    return (
        <Popover
            zIndex={popover_zindex.TRANSACTION.toString()}
            alignment={isDbotRTL() ? 'right' : 'left'}
            className='transactions__item-wrapper'
            is_open={!!(contract && active_transaction_id === contract?.transaction_ids?.buy)}
            message={contract && <PopoverContent contract={contract} />}
        >
            <div
                data-testid='dt_transactions_item'
                className='transactions__item'
                onClick={() => onClickTransaction && onClickTransaction(contract?.transaction_ids?.buy || null)}
            >
                <div className='transactions__cell transactions__trade-type'>
                    <div className='transactions__loader-container'>
                        {contract ? (
                            <TransactionIconWithText
                                icon={
                                    <MarketIcon
                                        type={(contract as any).underlying_symbol || (contract as any).underlying}
                                    />
                                }
                                title={
                                    contract.display_name ||
                                    getSymbolDisplayNameSync(
                                        (contract as any).underlying_symbol || (contract as any).underlying || ''
                                    )
                                }
                            />
                        ) : (
                            <TransactionIconLoader />
                        )}
                    </div>
                    <div className='transactions__loader-container'>
                        {contract ? (
                            <TransactionIconWithText
                                icon={<TradeTypeIcon type={contract.contract_type || ''} size='sm' />}
                                title={getContractTypeName(contract)}
                            />
                        ) : (
                            <TransactionIconLoader />
                        )}
                    </div>
                </div>
                <div className='transactions__cell transactions__entry-spot'>
                    <TransactionIconWithText
                        icon={<LegacyRadioOnIcon height={10} width={10} />}
                        title={localize('Entry spot')}
                        message={contract?.entry_spot ?? <TransactionFieldLoader />}
                    />
                </div>
                <div className='transactions__cell transactions__exit-spot'>
                    <TransactionIconWithText
                        icon={<LegacyRadioOffIcon height={10} width={10} />}
                        title={localize('Exit spot')}
                        message={
                            contract?.exit_spot ? (
                                <span>
                                    {contract.exit_spot}
                                    {exit_digit !== null && (
                                        <span
                                            style={{
                                                marginLeft: 6,
                                                fontWeight: 700,
                                                color: 'var(--text-prominent)',
                                                background: 'var(--general-section-1)',
                                                padding: '1px 6px',
                                                borderRadius: 4,
                                                fontSize: '0.95em',
                                            }}
                                            title={localize('Exit Digit')}
                                        >
                                            {exit_digit}
                                        </span>
                                    )}
                                </span>
                            ) : (
                                <TransactionFieldLoader />
                            )
                        }
                    />
                </div>
                <div className='transactions__cell transactions__stake'>
                    {contract ? (
                        <Money amount={contract.buy_price} currency={contract.currency} show_currency />
                    ) : (
                        <TransactionFieldLoader />
                    )}
                </div>
                <div className='transactions__cell transactions__profit'>
                    {contract?.is_completed ? (
                        <div
                            className={classNames({
                                'transactions__profit--win': contract?.profit && contract?.profit >= 0,
                                'transactions__profit--loss': contract?.profit && contract?.profit < 0,
                            })}
                        >
                            <Money amount={Math.abs(contract.profit || 0)} currency={contract.currency} show_currency />
                        </div>
                    ) : (
                        <TransactionFieldLoader />
                    )}
                </div>
            </div>
        </Popover>
    );
};

export default Transaction;
