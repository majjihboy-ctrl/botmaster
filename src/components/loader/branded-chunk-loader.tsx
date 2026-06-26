import { localize } from '@deriv-com/translations';
import BrandedSpinner from './branded-spinner';
import './branded-chunk-loader.scss';

type TBrandedChunkLoader = {
    message?: string;
};

export default function BrandedChunkLoader({ message }: TBrandedChunkLoader) {
    return (
        <div className='branded-chunk-loader'>
            <BrandedSpinner />
            <div className='branded-chunk-loader__message'>{message ?? localize('Loading...')}</div>
        </div>
    );
}
