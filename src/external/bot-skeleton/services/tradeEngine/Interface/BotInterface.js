import { observer as globalObserver } from '../../../utils/observer';
import { createDetails } from '../utils/helpers';

const getBotInterface = tradeEngine => {
    const getDetail = i => createDetails(tradeEngine.data.contract)[i];

    return {
        init: (...args) => tradeEngine.init(...args),
        start: (...args) => tradeEngine.start(...args),
        stop: (...args) => tradeEngine.stop(...args),
        purchase: contract_type => tradeEngine.purchase(contract_type),
        getAskPrice: contract_type => Number(getProposal(contract_type, tradeEngine).ask_price),
        getPayout: contract_type => Number(getProposal(contract_type, tradeEngine).payout),
        getPurchaseReference: () => tradeEngine.getPurchaseReference(),
        // Market switching. Blocks run inside the bot sandbox, where `window` is the sandbox's own global and
        // is invisible to the engine, so they must talk to the engine through these Bot.* calls.
        setForcedSymbol: symbol => tradeEngine.setForcedSymbol(symbol),
        setAlternateMarkets: (enabled, every) => tradeEngine.setAlternateMarkets(enabled, every),
        isSellAvailable: () => tradeEngine.isSellAtMarketAvailable(),
        sellAtMarket: () => tradeEngine.sellAtMarket(),
        getSellPrice: () => getSellPrice(tradeEngine),
        isResult: result => getDetail(10) === result,
        isTradeAgain: result => globalObserver.emit('bot.trade_again', result),
        // Slow mode: the after-purchase stack always runs (a contract just closed).
        // Fast mode: contracts settle in the background. Each settled contract is queued
        // and handed to the after-purchase stack one at a time, in settlement order, so
        // every win/loss updates the stake (e.g. Martingale) exactly once.
        shouldRunAfterPurchase: () => (tradeEngine.is_fast_mode ? takeNextSettled(tradeEngine) : true),
        // Fast mode only: true if another settled result is queued (and loads it).
        hasQueuedResult: () => (tradeEngine.is_fast_mode ? takeNextSettled(tradeEngine) : false),
        readDetails: i => getDetail(i - 1),
    };
};

const takeNextSettled = tradeEngine => {
    const next = tradeEngine.fastSettledQueue.shift();
    if (!next) return false;
    tradeEngine.data.contract = next;
    return true;
};

const getProposal = (contract_type, tradeEngine) => {
    return tradeEngine.data.proposals.find(
        proposal =>
            proposal.contract_type === contract_type &&
            proposal.purchase_reference === tradeEngine.getPurchaseReference()
    );
};

const getSellPrice = tradeEngine => {
    return tradeEngine.getSellPrice();
};

export default getBotInterface;
