import React, { useEffect, useRef, useState } from 'react';
import { Localize } from '@deriv-com/translations';
import './risk-disclaimer.scss';

/**
 * Mandatory risk disclosure for derivative/CFD products.
 * Rendered globally (fixed position) as a caution icon on every page.
 * Clicking the icon toggles the full disclaimer message.
 */
const RiskDisclaimer = () => {
    const [is_open, setIsOpen] = useState(false);
    const wrapper_ref = useRef(null);

    useEffect(() => {
        const handleClickOutside = event => {
            if (wrapper_ref.current && !wrapper_ref.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        const handleEscape = event => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, []);

    return (
        <div className='risk-disclaimer' ref={wrapper_ref} data-testid='dt_risk_disclaimer'>
            <button
                type='button'
                className='risk-disclaimer__trigger'
                aria-label='Risk disclaimer'
                aria-expanded={is_open}
                onClick={() => setIsOpen(prev => !prev)}
            >
                <svg
                    className='risk-disclaimer__icon'
                    width='22'
                    height='22'
                    viewBox='0 0 24 24'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                >
                    <path
                        d='M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z'
                        stroke='currentColor'
                        strokeWidth='1.8'
                        strokeLinejoin='round'
                    />
                    <line x1='12' y1='9' x2='12' y2='13.5' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' />
                    <circle cx='12' cy='16.5' r='1' fill='currentColor' />
                </svg>
            </button>

            {is_open && (
                <div className='risk-disclaimer__popover' role='dialog' aria-label='Risk disclaimer'>
                    <p className='risk-disclaimer__text'>
                        <Localize i18n_default_text='Deriv offers complex derivatives, such as options and contracts for difference (“CFDs”). These products may not be suitable for all clients, and trading them puts you at risk. Please make sure that you understand the following risks before trading Deriv products: a) you may lose some or all of the money you invest in the trade, b) if your trade involves currency conversion, exchange rates will affect your profit and loss. You should never trade with borrowed money or with money that you cannot afford to lose.' />
                    </p>
                    <button type='button' className='risk-disclaimer__close' onClick={() => setIsOpen(false)}>
                        <Localize i18n_default_text='Close' />
                    </button>
                </div>
            )}
        </div>
    );
};

export default RiskDisclaimer;
