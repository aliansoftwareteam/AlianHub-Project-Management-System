// Two of the first-run checklist items are "have you looked at this yet", which no stored data can
// answer — a notification setting looks identical whether the owner chose it or it was seeded. So
// those two are recorded when the screen is opened.
//
// localStorage rather than the user document: a new field on a strict schema is a migration, and a
// checklist item unticking itself on a second machine is a much smaller problem.
const PREFIX = 'alianhub_firstrun_';

export const FIRST_RUN_STEPS = {
    BOARD_VIEW: 'board_view',
    NOTIFICATIONS: 'notifications',
};

export function markFirstRunStep (step) {
    try {
        localStorage.setItem(PREFIX + step, '1');
    } catch (error) {
        // Private browsing and full quotas both throw here. A missed tick is not worth an error.
    }
}

export function isFirstRunStepDone (step) {
    try {
        return localStorage.getItem(PREFIX + step) === '1';
    } catch (error) {
        return false;
    }
}
