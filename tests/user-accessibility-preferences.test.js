const mongoose = require('mongoose');
const { schema } = require('../utils/mongo-handler/schema.js');
const { toSelfView, sanitizeSelfUpdate, MEMBER_FIELDS } = require('../Modules/Users/helpers/userAccessRules');

describe('the single-key shortcut switch is stored on the user', () => {
    const Users = mongoose.models.A11yPrefsUser || mongoose.model('A11yPrefsUser', new mongoose.Schema(schema.users, { strict: true, timestamps: true }));

    it('survives the strict user schema', () => {
        const doc = new Users({ accessibilityPreferences: { singleKeyShortcuts: false } });
        expect(doc.toObject().accessibilityPreferences.singleKeyShortcuts).toBe(false);
    });

    it('leaves a user who never changed it without a value, which reads as on', () => {
        const doc = new Users({});
        expect(doc.toObject().accessibilityPreferences?.singleKeyShortcuts).toBeUndefined();
    });

    it('can be written by the user through the self update', () => {
        const checked = sanitizeSelfUpdate({ $set: { 'accessibilityPreferences.singleKeyShortcuts': false } });
        expect(checked).toEqual({ ok: true, update: { $set: { 'accessibilityPreferences.singleKeyShortcuts': false } } });
    });

    it('comes back in the self view and stays out of what other members see', () => {
        const view = toSelfView({ _id: 'u1', accessibilityPreferences: { singleKeyShortcuts: false } });
        expect(view.accessibilityPreferences).toEqual({ singleKeyShortcuts: false });
        expect(MEMBER_FIELDS).not.toContain('accessibilityPreferences');
    });
});
