import { getSocketURL } from '@/components/shared';
import DerivAPIBasic from '@deriv/deriv-api/dist/DerivAPIBasic';
import APIMiddleware from './api-middleware';

/**
 * Singleton instance management for DerivAPI
 */
let derivApiInstance = null;
let derivApiPromise = null;
let currentWebSocketURL = null;

/**
 * Clears the singleton instance (useful for logout or forced reconnection).
 * @param {boolean} keepPromise - If true, do not null derivApiPromise (used while a new
 *   instance is being created so concurrent callers still await the same creation).
 */
export const clearDerivApiInstance = (keepPromise = false) => {
    if (derivApiInstance?.connection) {
        try {
            // Remove reference first so the close event of the OLD socket does not
            // null out a brand-new instance that was assigned in the meantime.
            const conn = derivApiInstance.connection;
            derivApiInstance = null;
            currentWebSocketURL = null;
            if (conn.readyState === WebSocket.OPEN || conn.readyState === WebSocket.CONNECTING) {
                conn.close();
            }
        } catch (error) {
            console.error('[DerivAPI] Error closing WebSocket:', error);
            derivApiInstance = null;
            currentWebSocketURL = null;
        }
    } else {
        derivApiInstance = null;
        currentWebSocketURL = null;
    }
    if (!keepPromise) {
        derivApiPromise = null;
    }
};

/**
 * Generates a Deriv API instance with WebSocket connection using singleton pattern
 * Prevents multiple WebSocket connections by reusing existing instance
 * Now supports async WebSocket URL fetching with authenticated flow
 * @param {boolean} forceNew - Force creation of new instance (default: false)
 * @returns Promise with DerivAPIBasic instance
 */
export const generateDerivApiInstance = async (forceNew = false) => {
    // If forcing new instance, clear existing one
    if (forceNew) {
        console.log('[DerivAPI] Forcing new instance creation');
        clearDerivApiInstance();
    }

    // If there's already an instance, check its state
    if (derivApiInstance) {
        const readyState = derivApiInstance.connection?.readyState;
        // Return existing instance if it's connecting or open
        if (readyState === WebSocket.CONNECTING || readyState === WebSocket.OPEN) {
            console.log('[DerivAPI] Reusing existing instance (state:', readyState, ')');
            return derivApiInstance;
        }
        // Connection is closed (3) or closing (2) — discard and create new
        console.log('[DerivAPI] Existing instance not usable (state:', readyState, '), creating new');
        clearDerivApiInstance();
    }

    // If there's already a creation in progress, return that promise
    if (derivApiPromise) {
        console.log('[DerivAPI] Reusing existing creation promise');
        try {
            return await derivApiPromise;
        } catch (e) {
            // Previous creation failed — fall through and try again
            console.warn('[DerivAPI] Previous creation promise failed, retrying:', e);
            derivApiPromise = null;
        }
    }

    // Create new instance
    derivApiPromise = (async () => {
        try {
            // Await the async getSocketURL() function
            const wsURL = await getSocketURL();

            // Account switch (demo ↔ real): URL changed — close old socket only,
            // keep this creation promise so concurrent callers still resolve here.
            if (currentWebSocketURL && currentWebSocketURL !== wsURL) {
                console.log('[DerivAPI] WebSocket URL changed, clearing old instance');
                clearDerivApiInstance(true);
            }

            currentWebSocketURL = wsURL;

            console.log('[DerivAPI] Creating new WebSocket connection to:', wsURL);
            const deriv_socket = new WebSocket(wsURL);
            const deriv_api = new DerivAPIBasic({
                connection: deriv_socket,
                middleware: new APIMiddleware({}),
            });

            // Store the instance immediately (don't wait for connection)
            derivApiInstance = deriv_api;

            // Set up close handler to clear instance ONLY if it is still the active one
            deriv_socket.addEventListener('close', () => {
                console.log('[DerivAPI] WebSocket connection closed');
                if (derivApiInstance === deriv_api) {
                    derivApiInstance = null;
                    currentWebSocketURL = null;
                }
            });

            // Log when connection opens
            deriv_socket.addEventListener('open', () => {
                console.log('[DerivAPI] WebSocket connection established');
            });

            deriv_socket.addEventListener('error', error => {
                console.error('[DerivAPI] WebSocket connection error:', error);
            });

            return deriv_api;
        } catch (error) {
            console.error('[DerivAPI] Error creating instance:', error);
            derivApiInstance = null;
            currentWebSocketURL = null;
            throw error;
        } finally {
            // Clear the promise after a short delay to allow reuse during concurrent calls
            setTimeout(() => {
                derivApiPromise = null;
            }, 150);
        }
    })();

    // Prevent "Uncaught (in promise)" when no waiter handles a rejection.
    // Callers that await still receive the error normally.
    derivApiPromise.catch(() => {});

    return derivApiPromise;
};

export const getLoginId = () => {
    const login_id = localStorage.getItem('active_loginid');
    if (login_id && login_id !== 'null') return login_id;
    return null;
};

export const V2GetActiveAccountId = () => {
    const account_id = localStorage.getItem('active_loginid');
    if (account_id && account_id !== 'null') return account_id;
    return null;
};

export const getToken = () => {
    const active_loginid = getLoginId();
    const client_accounts = JSON.parse(localStorage.getItem('accountsList')) ?? undefined;
    const active_account = (client_accounts && client_accounts[active_loginid]) || {};
    return {
        token: active_account ?? undefined,
        account_id: active_loginid ?? undefined,
    };
};
