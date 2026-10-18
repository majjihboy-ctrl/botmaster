import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { Localize, localize } from '@deriv-com/translations';
import './execution-switch.scss';

// Normal / Fast execution switch, shown beside the Run button.
const ExecutionSwitch = observer(() => {
    const { run_panel } = useStore();
    const { execution_mode, setExecutionMode } = run_panel;
    const is_fast = execution_mode === 'fast';

    return (
        <button
            type='button'
            role='switch'
            aria-checked={is_fast}
            aria-label={localize('Fast execution')}
            title={localize(
                'Fast: settles each trade the moment it closes and buys again without waiting for the next tick.'
            )}
            className={classNames('execution-switch', { 'execution-switch--fast': is_fast })}
            onClick={() => setExecutionMode(is_fast ? 'normal' : 'fast')}
        >
            <span className='execution-switch__text'>
                <span className='execution-switch__label'>
                    <Localize i18n_default_text='Execution' />
                </span>
                <span className='execution-switch__value'>
                    {is_fast ? <Localize i18n_default_text='FAST' /> : <Localize i18n_default_text='NORMAL' />}
                </span>
            </span>
            <span className='execution-switch__track'>
                <span className='execution-switch__thumb' />
            </span>
        </button>
    );
});

export default ExecutionSwitch;
