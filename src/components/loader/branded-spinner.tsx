import React from 'react';
import { getImageLocation } from '@/public-path';
import './branded-spinner.scss';

const BrandedSpinner = () => {
    return (
        <div className='branded-spinner'>
            <div className='branded-spinner__arc branded-spinner__arc--1' />
            <div className='branded-spinner__arc branded-spinner__arc--2' />
            <div className='branded-spinner__ring branded-spinner__ring--1' />
            <div className='branded-spinner__ring branded-spinner__ring--2' />
            <div className='branded-spinner__ring branded-spinner__ring--3' />
            <div className='branded-spinner__ring branded-spinner__ring--4' />
            <div className='branded-spinner__glow' />
            <img className='branded-spinner__logo' src={getImageLocation('boot-splash-logo.png')} alt='botmaster' />
        </div>
    );
};

export default BrandedSpinner;
