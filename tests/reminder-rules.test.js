/**
 * Time-Entry Reminder Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/TimeSheet/helpers/reminderRules.js. Pure — no DB/mail.
 */

const { usersNeedingReminder, reminderSubject, reminderHtml } = require('../Modules/TimeSheet/helpers/reminderRules');

const USERS = [
    { _id: 'u1', Employee_Email: 'a@x.com', Employee_Name: 'Alice A' },
    { _id: 'u2', Employee_Email: 'b@x.com', Employee_Name: 'Bob B' },
    { _id: 'u3', Employee_Email: '', Employee_Name: 'No Email' },
];

describe('🔔 TIME REMINDERS - Rules', () => {

    describe('usersNeedingReminder', () => {
        test('reminds members who have not logged + have an email', () => {
            const r = usersNeedingReminder({ users: USERS, loggedUserIds: ['u1'] });
            expect(r.map((u) => u._id)).toEqual(['u2']); // u1 logged, u3 has no email
        });
        test('reminds everyone with an email when none logged', () => {
            expect(usersNeedingReminder({ users: USERS, loggedUserIds: [] }).map((u) => u._id)).toEqual(['u1', 'u2']);
        });
        test('reminds no one when all (with email) logged', () => {
            expect(usersNeedingReminder({ users: USERS, loggedUserIds: ['u1', 'u2'] })).toEqual([]);
        });
        test('handles empty / missing input', () => {
            expect(usersNeedingReminder({})).toEqual([]);
            expect(usersNeedingReminder()).toEqual([]);
        });
    });

    describe('message', () => {
        test('subject mentions time', () => expect(reminderSubject()).toMatch(/time/i));
        test('html greets by first name', () => expect(reminderHtml('Alice A')).toContain('Alice'));
        test('html falls back to "there"', () => expect(reminderHtml()).toContain('there'));
    });
});
