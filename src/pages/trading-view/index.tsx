import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import TradingViewComponent from '@/components/trading-view-chart/trading-view';
import { useStore } from '@/hooks/useStore';
import { useDevice } from '@deriv-com/ui';
import './trading-view-page.scss';

// Full-page version of the TradingView iframe already used by the Bot Builder
// "TradingView Chart" popup (components/trading-view-chart). Same component, no
// second integration.
//
// The chart is a cross-origin iframe (charts.deriv.com), so its own header can't
// be restyled from here. What can be done is cropping: the iframe is shifted up
// by CROP_TOP px inside this overflow:hidden page, which hides the tall logo
// strip above the toolbar and gives that height back to the chart.
const CROP_TOP = 72;

// The Run Panel is a position:fixed drawer (36.6rem wide), so it would simply
// cover a cross-origin iframe. Reserving its width on this page's own container
// makes the chart shrink and sit beside it, like the SmartChart tab does.
const DRAWER_WIDTH = 366;

const TradingViewPage = observer(() => {
    const page_ref = useRef<HTMLDivElement | null>(null);
    const [height, setHeight] = useState<number | undefined>(undefined);
    const { isDesktop } = useDevice();
    const { run_panel } = useStore();
    const reserved_width = isDesktop && run_panel.is_drawer_open ? DRAWER_WIDTH : 0;

    // Height is measured (viewport/body bottom minus where this page starts) because
    // the parent grid cell never resolves to a real height for an iframe-only page.
    const update = () => {
        const el = page_ref.current;
        if (!el) return;
        const top = Math.max(0, el.getBoundingClientRect().top);
        const body_el = el.closest('.main-body');
        const bottom = body_el ? body_el.getBoundingClientRect().bottom : window.innerHeight;
        setHeight(Math.max(300, bottom - top));
    };

    useLayoutEffect(() => {
        update();
    }, []);

    useEffect(() => {
        window.addEventListener('resize', update);
        // Layout above (header, tab bar) can settle a moment after mount.
        const timers = [setTimeout(update, 100), setTimeout(update, 500)];
        return () => {
            window.removeEventListener('resize', update);
            timers.forEach(clearTimeout);
        };
    }, []);

    return (
        <div
            className='trading-view-page'
            ref={page_ref}
            style={{
                ...(height ? { height: `${height}px` } : undefined),
                width: `calc(100% - ${reserved_width}px)`,
                transition: 'width 0.3s ease',
            }}
        >
            <div style={{ marginTop: `-${CROP_TOP}px`, height: height ? `${height + CROP_TOP}px` : '100%' }}>
                <TradingViewComponent />
            </div>
        </div>
    );
});

export default TradingViewPage;
