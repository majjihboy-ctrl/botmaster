import { useRef, useState } from 'react';
import { useDevice } from '@deriv-com/ui';
import ForexTrader from './forex-trader';
import { PANEL_MIN_WIDTH, savePanelWidth, setPanelWidth, toggleWidePanel, usePanelWidth } from './panel-size';
import './forex-panel.scss';

/**
 * The Forex Trader tool as the right-hand panel on the TradingView tab,
 * in the exact spot the bot Run Panel normally occupies (same position and
 * width as that drawer). Phones get a bottom sheet instead, same as the
 * Run Panel is a bottom sheet there.
 */
const ForexPanel = () => {
    const { isDesktop } = useDevice();
    const [open, setOpen] = useState(false);
    const [everOpened, setEverOpened] = useState(false);
    const width = usePanelWidth();
    const dragging = useRef(false);
    const [isDragging, setIsDragging] = useState(false);

    if (isDesktop) {
        // Drag the left edge to make the panel wider or narrower; double-tap the edge to reset.
        const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
            dragging.current = true;
            setIsDragging(true);
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
        };
        const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
            if (dragging.current) setPanelWidth(window.innerWidth - e.clientX, false);
        };
        const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
            if (!dragging.current) return;
            dragging.current = false;
            setIsDragging(false);
            e.currentTarget.releasePointerCapture(e.pointerId);
            savePanelWidth();
        };
        return (
            <aside
                className={`forex-panel forex-panel--desktop${isDragging ? ' is-dragging' : ''}`}
                style={{ width: `${width}px` }}
            >
                <div
                    className='forex-panel__edge'
                    role='separator'
                    aria-orientation='vertical'
                    title='Drag to resize · double-click to reset'
                    onPointerDown={onDown}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                    onDoubleClick={() => setPanelWidth(PANEL_MIN_WIDTH)}
                />
                <span className='forex-panel__hint'>⚡ Forex Trader · drag the left edge to resize</span>
                <button
                    type='button'
                    className='forex-panel__enlarge'
                    onClick={toggleWidePanel}
                    title={width > PANEL_MIN_WIDTH + 40 ? 'Make smaller' : 'Make bigger'}
                >
                    {width > PANEL_MIN_WIDTH + 40 ? '⤡' : '⤢'}
                </button>
                <ForexTrader variant='panel' panelWidth={width} />
            </aside>
        );
    }

    return (
        <aside className={`forex-panel forex-panel--sheet${open ? ' is-open' : ''}`}>
            <button
                type='button'
                className='forex-panel__toggle'
                onClick={() => {
                    setOpen(o => !o);
                    setEverOpened(true);
                }}
            >
                ⚡ Forex Trader <span>{open ? '▾' : '▴'}</span>
            </button>
            <div className='forex-panel__body'>{everOpened && <ForexTrader variant='panel' />}</div>
        </aside>
    );
};

export default ForexPanel;
