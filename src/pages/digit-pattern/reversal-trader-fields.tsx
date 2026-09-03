import React from 'react';

type TSliderFieldProps = {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    disabled?: boolean;
    onChange: (value: number) => void;
    prefix?: string;
    suffix?: string;
    decimals?: number;
};

/** Slider + directly-editable number input, kept in sync both ways. */
export const SliderField: React.FC<TSliderFieldProps> = ({
    label,
    value,
    min,
    max,
    step,
    disabled,
    onChange,
    prefix = '',
    suffix = '',
    decimals = 2,
}) => {
    const [text, setText] = React.useState(value.toFixed(decimals));

    React.useEffect(() => {
        setText(value.toFixed(decimals));
    }, [value, decimals]);

    const commit = (raw: string) => {
        let num = parseFloat(raw);
        if (Number.isNaN(num)) num = value;
        num = Math.min(max, Math.max(min, num));
        onChange(num);
        setText(num.toFixed(decimals));
    };

    return (
        <div className='digit-pattern__slider-field'>
            <div className='digit-pattern__slider-label-row'>
                <span className='digit-pattern__field-label'>{label}</span>
                <div className='digit-pattern__value-input-wrap'>
                    {prefix && <span className='digit-pattern__value-affix'>{prefix}</span>}
                    <input
                        type='number'
                        inputMode='decimal'
                        className='digit-pattern__value-input'
                        value={text}
                        min={min}
                        max={max}
                        step={step}
                        disabled={disabled}
                        onChange={e => setText(e.target.value)}
                        onBlur={e => commit(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                    />
                    {suffix && <span className='digit-pattern__value-affix'>{suffix}</span>}
                </div>
            </div>
            <input
                type='range'
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={disabled}
                onChange={e => onChange(parseFloat(e.target.value))}
            />
        </div>
    );
};

type TToggleSwitchProps = {
    checked: boolean;
    disabled?: boolean;
    onChange: (value: boolean) => void;
    label: React.ReactNode;
};

export const ToggleSwitch: React.FC<TToggleSwitchProps> = ({ checked, disabled, onChange, label }) => (
    <div className='digit-pattern__toggle-row'>
        <button
            type='button'
            role='switch'
            aria-checked={checked}
            disabled={disabled}
            className={`digit-pattern__toggle ${checked ? 'on' : ''}`}
            onClick={() => onChange(!checked)}
        >
            <span className='digit-pattern__toggle-knob' />
        </button>
        <span className='digit-pattern__toggle-label' onClick={() => !disabled && onChange(!checked)}>
            {label}
        </span>
    </div>
);
