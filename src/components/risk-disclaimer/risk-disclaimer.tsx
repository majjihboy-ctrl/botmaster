import React, { useEffect, useState } from 'react';
import { Localize } from '@deriv-com/translations';
import './risk-disclaimer.scss';

/**
 * Mandatory risk disclosure for derivative/CFD products.
 * Rendered globally as a caution icon fixed in the bottom-left corner on
 * every page. Clicking it opens a centered modal with the full disclaimer.
 */
const RiskDisclaimer = () => {
    const [is_open, setIsOpen] = useState(false);

    useEffect(() => {
        const handleEscape = event => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, []);

    return (
        <>
            <button
                type='button'
                className='risk-disclaimer__trigger'
                aria-label='Risk disclaimer'
                aria-expanded={is_open}
                onClick={() => setIsOpen(true)}
                data-testid='dt_risk_disclaimer'
            >
                !
            </button>

            {is_open && (
                <div className='risk-disclaimer__overlay' onClick={() => setIsOpen(false)}>
                    <div
                        className='risk-disclaimer__modal'
                        role='dialog'
                        aria-modal='true'
                        aria-label='Risk disclaimer'
                        onClick={e => e.stopPropagation()}
                    >
                        <div className='risk-disclaimer__header'>
                            <h3 className='risk-disclaimer__title'>
                                <Localize i18n_default_text='Risk Disclaimer' />
                            </h3>
                            <button
                                type='button'
                                className='risk-disclaimer__close'
                                aria-label='Close'
                                onClick={() => setIsOpen(false)}
                            >
                                <svg width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'>
                                    <path
                                        d='M2 2L14 14M14 2L2 14'
                                        stroke='currentColor'
                                        strokeWidth='1.6'
                                        strokeLinecap='round'
                                    />
                                </svg>
                            </button>
                        </div>

                        <p className='risk-disclaimer__paragraph'>
                            <Localize i18n_default_text='Deriv offers complex derivatives, such as options and contracts for difference (“CFDs”). These products may not be suitable for all clients, and trading them puts you at risk.' />
                        </p>

                        <p className='risk-disclaimer__paragraph'>
                            <Localize i18n_default_text='Please understand the following risks before trading Deriv products:' />
                        </p>

                        <p className='risk-disclaimer__paragraph'>
                            <Localize i18n_default_text='a) You may lose some or all of the money you invest in the trade' />
                            <br />
                            <Localize i18n_default_text='b) If your trade involves currency conversion, exchange rates will affect your profit and loss. You should never trade with borrowed money or with money that you cannot afford to lose.' />
                        </p>
                    </div>
                </div>
            )}
        </>
    );
};

export default RiskDisclaimer;
