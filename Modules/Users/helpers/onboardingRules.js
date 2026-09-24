const ONBOARDING_FLAGS = [
    'dismissed', 'openedProject', 'completedTask', 'loggedTime',
    'reviewedPermissions', 'chosenApps', 'viewedBoard', 'viewedNotifications',
];
const TOURS = ['shell', 'project', 'board', 'list'];

const refuse = (error) => ({ ok: false, error });

const sanitizeOnboardingPatch = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse('The body must be an object.');
    const keys = Object.keys(body);
    if (!keys.length) return refuse('Nothing to save.');

    const $set = {};
    let tour = null;
    for (const key of keys) {
        const value = body[key];
        if (key === 'tourOffered') {
            if (!TOURS.includes(value)) return refuse(`tourOffered must be one of ${TOURS.join(', ')}.`);
            tour = value;
        } else if (ONBOARDING_FLAGS.includes(key)) {
            if (typeof value !== 'boolean') return refuse(`${key} must be true or false.`);
            $set[`homeChecklist.${key}`] = value;
        } else {
            return refuse(`${key} cannot be changed here.`);
        }
    }

    const update = {};
    if (Object.keys($set).length) update.$set = $set;
    if (tour) update.$addToSet = { 'homeChecklist.toursOffered': tour };
    return { ok: true, update };
};

module.exports = { ONBOARDING_FLAGS, TOURS, sanitizeOnboardingPatch };
