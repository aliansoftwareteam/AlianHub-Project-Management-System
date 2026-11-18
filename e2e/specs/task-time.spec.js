const { test, expect } = require('../support/test');

test.describe('task time as a member', () => {
    test('the task panel\'s time read answers with the task\'s entries and total', async ({ state, loginAs }) => {
        const [task] = state.tasks;
        const member = await loginAs('member');
        const res = await member.api.get(`/api/v1/timesheet/task/${task._id}`);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(Array.isArray(res.body.data.entries)).toBe(true);
        expect(typeof res.body.data.totalMinutes).toBe('number');
    });
});
