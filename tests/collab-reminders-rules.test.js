/**
 * Personal Reminder Rules Test Suite (COLLAB-03)
 * AlianHub Project Management System
 *
 * Unit tests for Modules/Reminders/remindersRules.js. Pure — no DB / socket /
 * mail. Covers the "is due" predicate that drives firing and the in-app
 * notification document shape delivered to the reminder owner.
 */

const {
    isReminderDue,
    reminderMessage,
    buildReminderNotification,
    generateUniqueId,
} = require('../Modules/Reminders/remindersRules');

const NOW = new Date('2026-06-22T12:00:00.000Z');
const PAST = new Date('2026-06-22T11:59:00.000Z');
const FUTURE = new Date('2026-06-22T12:05:00.000Z');

describe('⏰ PERSONAL REMINDERS - Rules', () => {

    describe('isReminderDue', () => {
        test('a past, un-fired, live reminder is due', () => {
            expect(isReminderDue({ reminderAt: PAST, fired: false, deletedStatusKey: 0 }, NOW)).toBe(true);
        });
        test('reminderAt exactly now is due (<=)', () => {
            expect(isReminderDue({ reminderAt: NOW, fired: false, deletedStatusKey: 0 }, NOW)).toBe(true);
        });
        test('a future reminder is not due', () => {
            expect(isReminderDue({ reminderAt: FUTURE, fired: false, deletedStatusKey: 0 }, NOW)).toBe(false);
        });
        test('an already-fired reminder is never due', () => {
            expect(isReminderDue({ reminderAt: PAST, fired: true, deletedStatusKey: 0 }, NOW)).toBe(false);
        });
        test('a soft-deleted reminder is never due', () => {
            expect(isReminderDue({ reminderAt: PAST, fired: false, deletedStatusKey: 1 }, NOW)).toBe(false);
        });
        test('handles missing / junk input', () => {
            expect(isReminderDue(undefined, NOW)).toBe(false);
            expect(isReminderDue({}, NOW)).toBe(false);
            expect(isReminderDue({ reminderAt: 'not-a-date', fired: false, deletedStatusKey: 0 }, NOW)).toBe(false);
        });
    });

    describe('reminderMessage', () => {
        test('uses custom text when present', () => {
            expect(reminderMessage({ reminderText: 'Call the client' })).toBe('Call the client');
        });
        test('falls back when text is empty / missing', () => {
            expect(reminderMessage({ reminderText: '   ' })).toMatch(/reminder/i);
            expect(reminderMessage({})).toMatch(/reminder/i);
        });
    });

    describe('buildReminderNotification', () => {
        const reminder = {
            userId: 'u1',
            companyId: 'c1',
            taskId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
            projectId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
            reminderText: 'Review PR',
        };
        const notif = buildReminderNotification(reminder, NOW);

        test('targets the reminder owner as recipient', () => {
            expect(notif.userId).toBe('u1');
            expect(notif.assigneeUsers).toEqual(['u1']);
            expect(notif.notSeen).toEqual(['u1']);
            expect(notif.receiverID).toBe('u1');
        });
        test('populates every required notification field', () => {
            // Mirrors the schema `required: true` fields on notifications.
            expect(typeof notif.key).toBe('string');
            expect(notif.key.length).toBeGreaterThan(0);
            expect(notif.message).toBe('Review PR');
            expect(typeof notif.projectId).toBe('string');
            expect(typeof notif.type).toBe('string');
            expect(Array.isArray(notif.assigneeUsers)).toBe(true);
            expect(Array.isArray(notif.notSeen)).toBe(true);
            expect(notif.notificationType).toBe('push');
            expect(typeof notif.uniqueId).toBe('string');
            expect(notif.uniqueId.length).toBeGreaterThan(0);
        });
        test('carries ids through as strings', () => {
            expect(notif.taskId).toBe('aaaaaaaaaaaaaaaaaaaaaaaa');
            expect(notif.projectId).toBe('bbbbbbbbbbbbbbbbbbbbbbbb');
            expect(notif.companyId).toBe('c1');
        });
        test('owner-less reminder yields empty recipient arrays', () => {
            const n = buildReminderNotification({ reminderText: 'x' }, NOW);
            expect(n.userId).toBe('');
            expect(n.assigneeUsers).toEqual([]);
            expect(n.notSeen).toEqual([]);
        });
    });

    describe('generateUniqueId', () => {
        test('produces distinct non-empty ids', () => {
            const a = generateUniqueId();
            const b = generateUniqueId();
            expect(a).toBeTruthy();
            expect(b).toBeTruthy();
            expect(a).not.toBe(b);
        });
    });
});
