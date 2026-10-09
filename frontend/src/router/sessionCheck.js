import { isOfflineError } from '@/offline/offlineRules';

/* `unreachable` means the server gave no answer at all, which says nothing about the session: the
 * person may still be signed in, so the caller must not treat it as signed out. */
export const readSessionUser = async (userId, fetchUser) => {
    if (!userId) return { user: null, unreachable: false };
    try {
        const res = await fetchUser(userId);
        return { user: res && res.status === 200 ? res.data || null : null, unreachable: false };
    } catch (error) {
        if (!isOfflineError(error)) throw error;
        return { user: null, unreachable: true };
    }
};
