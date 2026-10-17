import React, { useMemo } from 'react';
import { isPreviewMode, PREVIEW_BASE_PATH } from '@/utils/is-preview-mode';
import './chunk-loader.scss';

type TChunkLoader = {
    message?: string;
    // 'fullscreen' covers the whole screen (app boot / connecting).
    // 'panel' covers only the area below the header + tab bar, so tabs stay clickable.
    variant?: 'fullscreen' | 'panel';
};

// One loader for the whole app: the same full-screen looping video as the boot splash
// (public/splash/*). Reuses the clip the splash picked for this visit so the two read
// as a single, continuous loading screen.
export default function ChunkLoader({ message, variant = 'fullscreen' }: TChunkLoader) {
    const { video, poster } = useMemo(() => {
        const base = isPreviewMode() ? PREVIEW_BASE_PATH : '';
        const set = window.matchMedia('(min-width: 901px)').matches ? 'desktop' : 'mobile';
        let n = 1;
        try {
            n = parseInt(localStorage.getItem(`bm_splash_last_${set}`) ?? '', 10) || 1;
        } catch {
            /* storage unavailable: first clip */
        }
        const name = `${base}/splash/${set}-${Math.min(Math.max(n, 1), 4)}`;
        return { video: `${name}.mp4`, poster: `${name}.jpg` };
    }, []);

    return (
        <div className={`chunk-loader chunk-loader--${variant}`} role='status'>
            <video
                className='chunk-loader__video'
                src={video}
                poster={poster}
                autoPlay
                muted
                loop
                playsInline
                preload='auto'
                aria-hidden='true'
            />
            <div className='chunk-loader__shade' />
            <div className='chunk-loader__content'>
                <div className='chunk-loader__brand'>BOTMASTER</div>
                {message ? <div className='chunk-loader__message'>{message}</div> : null}
                <div className='chunk-loader__track' aria-hidden='true' />
            </div>
        </div>
    );
}
