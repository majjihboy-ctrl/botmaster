import React from 'react';

type TSliderFieldProps = {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    disabled?: boolean;
    onChange: (value: number) => void;
    prefix?: string; // e.g. '$'
    suffix?: string; // e.g. 'x'
    decimals?: number;
};

/**
 * Slider + directly-editable number input, kept in sync both ways.
 * Dragging the slider updates the number; typing in the number field
 * (committed on blur/Enter) updates the slider and clamps to min/max.
 */
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
        <div className='speed-trader__slider-field'>
            <div className='speed-trader__slider-label-row'>
                <span className='speed-trader__field-label'>{label}</span>
                <div className='speed-trader__value-input-wrap'>
                    {prefix && <span className='speed-trader__value-affix'>{prefix}</span>}
                    <input
                        type='number'
                        inputMode='decimal'
                        className='speed-trader__value-input'
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
                    {suffix && <span className='speed-trader__value-affix'>{suffix}</span>}
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

/** Accessible on/off switch — visible in both light and dark themes,
 * unlike a bare native checkbox whose default styling can wash out. */
export const ToggleSwitch: React.FC<TToggleSwitchProps> = ({ checked, disabled, onChange, label }) => (
    <div className='speed-trader__toggle-row'>
        <button
            type='button'
            role='switch'
            aria-checked={checked}
            disabled={disabled}
            className={`speed-trader__toggle ${checked ? 'on' : ''}`}
            onClick={() => onChange(!checked)}
        >
            <span className='speed-trader__toggle-knob' />
        </button>
        <span
            className='speed-trader__toggle-label'
            onClick={() => !disabled && onChange(!checked)}
        >
            {label}
        </span>
    </div>
);
