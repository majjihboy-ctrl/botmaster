import React from 'react';
import classNames from 'classnames';
import Text from '@/components/shared_ui/text';
import {
    LabelPairedCircleCheckMdRegularIcon,
    LabelPairedCircleXmarkMdRegularIcon,
} from '@deriv/quill-icons/LabelPaired';
import { Localize, localize } from '@deriv-com/translations';

type TContractResultOverlayProps = {
    profit: number;
    exit_spot?: string | number | null;
};

/** Extract the last digit from a spot/price value */
const getExitDigit = (spot: string | number | undefined | null): string | null => {
    if (spot === undefined || spot === null || spot === '') return null;
    const str = String(spot);
    for (let i = str.length - 1; i >= 0; i--) {
        if (/\d/.test(str[i])) return str[i];
    }
    return null;
};

const ContractResultOverlay = ({ profit, exit_spot }: TContractResultOverlayProps) => {
    const has_won_contract = profit >= 0;
    const exit_digit = getExitDigit(exit_spot);

    return (
        <div
            className={classNames('db-contract-card__result', {
                'db-contract-card__result--won': has_won_contract,
                'db-contract-card__result--lost': !has_won_contract,
            })}
        >
            <Text weight='bold' className='db-contract-card__result-caption'>
                {has_won_contract ? (
                    <React.Fragment>
                        <Localize i18n_default_text='Won' />
                        <LabelPairedCircleCheckMdRegularIcon className='db-contract-card__result-icon' color='green' />
                    </React.Fragment>
                ) : (
                    <React.Fragment>
                        <Localize i18n_default_text='Lost' />
                        <LabelPairedCircleXmarkMdRegularIcon className='db-contract-card__result-icon' color='red' />
                    </React.Fragment>
                )}
            </Text>

            {exit_digit !== null && (
                <Text
                    weight='bold'
                    size='s'
                    className='db-contract-card__result-digit'
                    style={{
                        marginTop: 4,
                        display: 'block',
                        fontSize: '1.25em',
                        letterSpacing: '0.04em',
                    }}
                >
                    {localize('Digit')}: {exit_digit}
                </Text>
            )}
        </div>
    );
};

export default ContractResultOverlay;
