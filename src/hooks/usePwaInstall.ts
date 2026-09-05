import { useCallback, useEffect, useState } from 'react';

/**
 * Chrome/Edge fire this before showing their own install UI. Capturing it
 * lets us trigger the native install flow from our own button instead of
 * relying on the user noticing the browser's address-bar icon.
 * Not part of the standard lib.dom.ts typings yet, hence the local type.
 */
interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
    prompt: () => Promise<void>;
}

type TPlatform = 'ios' | 'other';

interface TPwaInstallState {
    /** True once the browser has signalled the app is installable and hasn't installed it yet. */
    canInstall: boolean;
    /** True if already running as an installed PWA (standalone display mode). */
    isInstalled: boolean;
    /** iOS Safari never fires beforeinstallprompt; it needs the manual "Add to Home Screen" steps. */
    platform: TPlatform;
    /** Shows the native install prompt. No-op (resolves false) if nothing was captured. */
    promptInstall: () => Promise<boolean>;
}

const isStandaloneDisplayMode = () =>
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari's own flag for "launched from home screen"
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

const detectPlatform = (): TPlatform => (/iphone|ipad|ipod/i.test(window.navigator.userAgent) ? 'ios' : 'other');

export const usePwaInstall = (): TPwaInstallState => {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [isInstalled, setIsInstalled] = useState(isStandaloneDisplayMode);
    const [platform] = useState<TPlatform>(detectPlatform);

    useEffect(() => {
        if (isInstalled) return;

        const handleBeforeInstallPrompt = (event: Event) => {
            // Stops Chrome auto-showing its mini-infobar; we control the timing instead.
            event.preventDefault();
            setDeferredPrompt(event as BeforeInstallPromptEvent);
        };
        const handleAppInstalled = () => {
            setDeferredPrompt(null);
            setIsInstalled(true);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, [isInstalled]);

    const promptInstall = useCallback(async () => {
        if (!deferredPrompt) return false;

        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        // The captured event can only be used once, win or lose.
        setDeferredPrompt(null);
        return outcome === 'accepted';
    }, [deferredPrompt]);

    return {
        canInstall: Boolean(deferredPrompt) && !isInstalled,
        isInstalled,
        platform,
        promptInstall,
    };
};
