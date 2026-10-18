// Deterrent against casual inspection of the site (right-click, F12 / view-source shortcuts and an
// open docked DevTools panel). This is NOT real protection: anything the browser downloads can
// still be read. Keep secrets on the server (api/ routes, Vercel env vars), never in this bundle.
const DEVTOOLS_THRESHOLD_PX = 170;
const CHECK_INTERVAL_MS = 1000;
const OVERLAY_ID = 'bm-devtools-block';

export const isBlockedShortcut = (e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>) => {
    const key = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (key === 'f12') return true;
    if (mod && e.shiftKey && ['i', 'j', 'c', 'k'].includes(key)) return true; // DevTools / console / picker
    if (mod && e.altKey && ['i', 'j', 'c', 'u'].includes(key)) return true; // macOS variants
    if (mod && key === 'u') return true; // view-source
    return false;
};

const isDevtoolsDocked = () => {
    const wide = window.outerWidth - window.innerWidth > DEVTOOLS_THRESHOLD_PX;
    const tall = window.outerHeight - window.innerHeight > DEVTOOLS_THRESHOLD_PX;
    return wide || tall;
};

const showOverlay = () => {
    if (document.getElementById(OVERLAY_ID)) return;
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute(
        'style',
        'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
            'background:#0e0e1a;color:#fff;font:600 16px/1.4 sans-serif;text-align:center;padding:24px;'
    );
    overlay.textContent = 'Developer tools are not allowed on this site. Close them to continue.';
    document.body.appendChild(overlay);
};

const hideOverlay = () => document.getElementById(OVERLAY_ID)?.remove();

export const enableAntiInspect = () => {
    if (typeof window === 'undefined' || process.env.NODE_ENV === 'development') return;
    if (['localhost', '127.0.0.1'].includes(window.location.hostname)) return;

    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener(
        'keydown',
        e => {
            if (isBlockedShortcut(e)) {
                e.preventDefault();
                e.stopPropagation();
            }
        },
        true
    );

    // Desktop only: on touch devices the window/viewport difference is not a DevTools signal.
    const is_desktop = window.matchMedia?.('(pointer: fine)').matches ?? false;
    if (!is_desktop) return;

    window.setInterval(() => {
        if (isDevtoolsDocked()) showOverlay();
        else hideOverlay();
    }, CHECK_INTERVAL_MS);
};
