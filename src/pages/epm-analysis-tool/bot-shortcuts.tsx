import { useState } from 'react';
import { Localize, localize } from '@deriv-com/translations';
import type { ContractType } from './contract-analysis';
import { useBotLoader } from './use-bot-loader';
import { resolveBot, readChoices, writeChoices, keyFor } from './bot-resolution';

interface Props {
    contractType: ContractType;
    /** One entry per side, e.g. ["Under 2", "Over 7"]. */
    sides: string[];
    /** Sides currently flagged -- Load bot only shows for these. */
    flaggedSides: string[];
}

function BotShortcuts({ contractType, sides, flaggedSides }: Props) {
    const { bots, loadingBotId, loadBot } = useBotLoader();
    const [choices, setChoices] = useState<Record<string, string>>(readChoices);

    // Free Bots carry no contract type, so they are listed together.
    const inCategory = bots;
    const others: typeof bots = [];

    const selectedFor = (side: string) => choices[keyFor(contractType, side)] ?? resolveBot(bots, contractType, side, choices)?.id;

    const onChoose = (side: string, botId: string | undefined) => {
        const next = { ...choices };
        if (botId === undefined) delete next[keyFor(contractType, side)];
        else next[keyFor(contractType, side)] = botId;
        setChoices(next);
        writeChoices(next);
    };

    if (!sides.length) return null;

    return (
        <div className='epm-analysis-tool__panel'>
            <h2 className='epm-analysis-tool__panel-title'>
                <Localize i18n_default_text='Your bots' />
            </h2>
            <div className='epm-analysis-tool__bot-list'>
                {sides.map(side => {
                    const selectedId = selectedFor(side);
                    const selectedBot = bots.find(b => b.id === selectedId);
                    const isFlagged = flaggedSides.includes(side);
                    return (
                        <div className='epm-analysis-tool__bot-row' key={side}>
                            <span className='epm-analysis-tool__bot-side'>
                                {side}
                                {isFlagged && (
                                    <span className='epm-analysis-tool__badge'>
                                        <Localize i18n_default_text='Rule met' />
                                    </span>
                                )}
                            </span>
                            <select
                                className='epm-analysis-tool__select'
                                value={selectedId ?? ''}
                                onChange={e => onChoose(side, e.target.value || undefined)}
                            >
                                <option value=''>{localize('— choose a bot —')}</option>
                                {inCategory.length > 0 && (
                                    <optgroup label={localize('Free Bots')}>
                                        {inCategory.map(b => (
                                            <option key={b.id} value={b.id}>
                                                {b.name}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                                {others.length > 0 && (
                                    <optgroup label={localize('Other bots')}>
                                        {others.map(b => (
                                            <option key={b.id} value={b.id}>
                                                {b.name}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                            </select>
                            {isFlagged && (
                                <button
                                    type='button'
                                    className='epm-analysis-tool__btn-primary epm-analysis-tool__btn-inline'
                                    disabled={!selectedBot || loadingBotId !== null}
                                    onClick={() => selectedBot && loadBot(selectedBot)}
                                >
                                    {loadingBotId === selectedId ? localize('Loading…') : localize('Load bot')}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default BotShortcuts;
