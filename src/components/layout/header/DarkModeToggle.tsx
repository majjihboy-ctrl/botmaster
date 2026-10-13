import { observer } from 'mobx-react-lite';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { LegacyThemeDarkIcon, LegacyThemeLightIcon } from '@deriv/quill-icons/Legacy';
import { useTranslations } from '@deriv-com/translations';
import './dark-mode-toggle.scss';

/**
 * Light/dark theme switch shown in the header bar (desktop). The footer keeps its own
 * switch; both drive the same theme hook so they always stay in sync.
 */
const DarkModeToggle = observer(() => {
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();
    const { localize } = useTranslations();
    const label = is_dark_mode_on ? localize('Switch to light mode') : localize('Switch to dark mode');

    return (
        <button
            type='button'
            className='header-theme-toggle'
            onClick={toggleTheme}
            aria-label={label}
            title={label}
            data-testid='dt_header_theme_toggle'
        >
            {is_dark_mode_on ? <LegacyThemeDarkIcon iconSize='xs' /> : <LegacyThemeLightIcon iconSize='xs' />}
        </button>
    );
});

export default DarkModeToggle;
