/* eslint-env browser */
const { MongoClient, ObjectId } = require('mongodb');
const { test, expect, asRole } = require('../support/test');
const { uniqueSuffix } = require('../support/fixtures');
const { resolveMongoUrl } = require('../support/env');

test.describe('inbox keyboard triage', () => {
    test.use(asRole('admin'));

    let client;
    const seeded = [];
    test.beforeAll(async () => {
        client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
        await client.connect();
    });
    test.afterAll(async () => {
        if (!client) return;
        const [first] = seeded;
        if (first) await client.db(first.companyId).collection('notifications').deleteMany({ _id: { $in: seeded.map((s) => s._id) } });
        await client.close();
    });

    test('j, then e and e, clears two cards without a click', async ({ page, state }) => {
        const suffix = uniqueSuffix();
        const admin = state.users.admin;
        const owner = state.users.owner;
        const task = state.tasks[0];
        // Stamped ahead of now so these three sit at the top whatever else the admin's Inbox holds.
        const base = Date.now() + 60 * 60 * 1000;
        const labels = ['Alpha', 'Bravo', 'Charlie'];
        const docs = labels.map((label, i) => ({
            _id: new ObjectId(),
            key: 'task_status',
            message: `<p>Triage ${label} ${suffix}</p>`,
            projectId: task.projectId,
            sprintId: task.sprintId,
            taskId: task._id,
            type: 'tasks',
            userId: owner.userId,
            assigneeUsers: [admin.userId],
            notSeen: [admin.userId],
            receiverID: admin.userId,
            notificationType: 'push',
            companyId: state.companyId,
            uniqueId: uniqueSuffix(),
            createdAt: new Date(base - i * 1000),
            updatedAt: new Date(base - i * 1000),
        }));
        await client.db(state.companyId).collection('notifications').insertMany(docs);
        seeded.push(...docs.map((d) => ({ _id: d._id, companyId: state.companyId })));

        await page.addInitScript(() => {
            for (const screen of ['shell', 'project', 'board', 'list']) localStorage.setItem(`ah.tour.skipped.${screen}`, '1');
            sessionStorage.setItem('ah.gs.dismissed', '1');
        });
        await page.goto(`/#/${state.companyId}/inbox`);
        const mine = page.locator('.ibx__card', { hasText: suffix });
        await expect(mine).toHaveCount(3);
        await expect(page.locator('.ibx__card').first()).toContainText(`Triage Alpha ${suffix}`);
        await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('ibx__card'))).toBe(true);

        await page.keyboard.press('j');
        await expect(page.locator('.ibx__card:focus')).toContainText(`Triage Bravo ${suffix}`);
        await page.keyboard.press('e');
        await expect(mine).toHaveCount(2);
        await expect(page.locator('.ibx__card:focus')).toContainText(`Triage Charlie ${suffix}`);
        await page.keyboard.press('e');
        await expect(mine).toHaveCount(1);
        await expect(mine.first()).toContainText(`Triage Alpha ${suffix}`);
        await expect(page.locator('.ibx__card:focus')).toHaveCount(1);
    });
});
