// Deriv-required risk disclaimer, shown site-wide per compliance instructions.
import './disclaimer-banner.scss';

const DISCLAIMER_TEXT =
    'Deriv offers complex derivatives, such as options and contracts for difference ("CFDs"). These products may not be suitable for all clients, and trading them puts you at risk. Please make sure that you understand the following risks before trading Deriv products: a) you may lose some or all of the money you invest in the trade, b) if your trade involves currency conversion, exchange rates will affect your profit and loss. You should never trade with borrowed money or with money that you cannot afford to lose.';

const DisclaimerBanner = () => {
    return (
        <div className='disclaimer-banner' role='contentinfo'>
            <p className='disclaimer-banner__text'>{DISCLAIMER_TEXT}</p>
        </div>
    );
};

export default DisclaimerBanner;
