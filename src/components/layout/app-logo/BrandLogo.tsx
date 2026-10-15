// Botmaster brand logo: blue "B" mark with a growth arrow, plus the wordmark.
// The wordmark follows the `fill` prop so it reads on light and dark surfaces.
// The header uses public/logo.png (see LogoMark); this inline SVG is used by the mobile menu.

type TBrandLogoProps = {
    width?: number;
    height?: number;
    fill?: string;
    className?: string;
};

export const BrandLogo = ({ width = 132, height = 32, fill = 'currentColor', className = '' }: TBrandLogoProps) => {
    return (
        <svg
            width={width}
            height={height}
            viewBox='0 0 132 32'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
            className={className}
            role='img'
            aria-label='Botmaster'
        >
            <defs>
                <linearGradient id='botmaster-logo-gradient' x1='0' y1='0' x2='1' y2='1'>
                    <stop offset='0' stopColor='#4F8EF7' />
                    <stop offset='1' stopColor='#1D4ED8' />
                </linearGradient>
            </defs>
            <g transform='scale(0.5)'>
                <rect width='64' height='64' rx='15' fill='url(#botmaster-logo-gradient)' />
                <path
                    fill='#ffffff'
                    fillRule='evenodd'
                    d='M20 15h15.5a9.5 9.5 0 0 1 6.4 16.5A10.5 10.5 0 0 1 37.5 49H20Zm9 8v6h6.5a3 3 0 0 0 0-6Zm0 13.5V43h8.5a3.25 3.25 0 0 0 0-6.5Z'
                />
                <path
                    d='M46 20l6-6m0 0h-4.5m4.5 0v4.5'
                    stroke='#34D399'
                    strokeWidth='3'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                />
            </g>
            <text
                x='42'
                y='22.5'
                fontFamily="Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
                fontSize='19'
                fontWeight='700'
                fill={fill}
                letterSpacing='-0.3'
            >
                Botmaster
            </text>
        </svg>
    );
};
