import { localize } from '@deriv-com/translations';
import BrandedSpinner from './branded-spinner';
import './branded-chunk-loader.scss';

type TBrandedChunkLoader = {
    message?: string;
};

export default function BrandedChunkLoader({ message }: TBrandedChunkLoader) {
    return (
        <div className='branded-chunk-loader'>
            <div className='branded-chunk-loader__ambient branded-chunk-loader__ambient--one' />
            <div className='branded-chunk-loader__ambient branded-chunk-loader__ambient--two' />
            <div className='branded-chunk-loader__panel'>
                <BrandedSpinner />
                <div className='branded-chunk-loader__copy'>
                    <div className='branded-chunk-loader__topline'>
                        <span className='branded-chunk-loader__dot' />
                        {localize('Botmaster')}
                    </div>
                    <div className='branded-chunk-loader__message'>{message ?? localize('Loading...')}</div>
                    <div className='branded-chunk-loader__progress'>
                        <div className='branded-chunk-loader__progress-fill' />
                    </div>
                </div>
            </div>
        </div>
    );
}
