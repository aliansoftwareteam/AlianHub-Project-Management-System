// Two of the first-run checklist items are "have you looked at this yet", which no stored data can
// answer — a notification setting looks identical whether the owner chose it or it was seeded. So
// those two are recorded when the screen is opened: on the user record, and in localStorage so the
// tick shows on this device before the user list is next loaded.
import { saveOnboarding } from "@/composable/onboardingState";

const PREFIX = 'alianhub_firstrun_';

export const FIRST_RUN_STEPS = {
    BOARD_VIEW: 'board_view',
    NOTIFICATIONS: 'notifications',
};

const RECORD_FLAG = {
    [FIRST_RUN_STEPS.BOARD_VIEW]: 'viewedBoard',
    [FIRST_RUN_STEPS.NOTIFICATIONS]: 'viewedNotifications',
};

export function markFirstRunStep (step) {
    if (isFirstRunStepDone(step)) return;
    try {
        localStorage.setItem(PREFIX + step, '1');
    } catch (error) {
        // Private browsing and full quotas both throw here; the user record still gets the tick.
    }
    if (RECORD_FLAG[step]) saveOnboarding({ [RECORD_FLAG[step]]: true });
}

export function isFirstRunStepDone (step) {
    try {
        return localStorage.getItem(PREFIX + step) === '1';
    } catch (error) {
        return false;
    }
}
