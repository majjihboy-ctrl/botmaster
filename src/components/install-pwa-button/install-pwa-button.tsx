import { useState } from 'react';
import Button from '@/components/shared_ui/button';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import { Localize } from '@deriv-com/translations';
import './install-pwa-button.scss';

const DownloadIcon = () => (
    <svg width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'>
        <path
            d='M8 1.5v8.25m0 0 3-3m-3 3-3-3M2.5 11v1.75c0 .966.784 1.75 1.75 1.75h7.5a1.75 1.75 0 0 0 1.75-1.75V11'
            stroke='currentColor'
            strokeWidth='1.3'
            strokeLinecap='round'
            strokeLinejoin='round'
        />
    </svg>
);

/**
 * Header install button.
 * - Chrome/Edge on Windows/Mac/Linux/Android: fires the native install
 *   prompt captured by usePwaInstall, so one tap installs the desktop or
 *   Android app.
 * - iOS Safari never exposes an install prompt, so tapping instead reveals
 *   the manual "Share -> Add to Home Screen" steps.
 * - Hides entirely once the app is already running standalone (installed).
 */
const InstallPwaButton = () => {
    const { canInstall, isInstalled, platform, promptInstall } = usePwaInstall();
    const [showIosSteps, setShowIosSteps] = useState(false);

    if (isInstalled) return null;
    if (platform !== 'ios' && !canInstall) return null;

    const handleClick = () => {
        if (platform === 'ios') {
            setShowIosSteps(prev => !prev);
            return;
        }
        promptInstall();
    };

    return (
        <div className='install-pwa-button'>
            <Button tertiary icon={<DownloadIcon />} onClick={handleClick}>
                <Localize i18n_default_text='Install app' />
            </Button>
            {showIosSteps && (
                <div className='install-pwa-button__ios-tooltip'>
                    <Localize i18n_default_text='Tap the Share icon, then "Add to Home Screen".' />
                </div>
            )}
        </div>
    );
};

export default InstallPwaButton;
