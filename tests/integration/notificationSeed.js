const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');
const { SEAT_ACTIVE, SEAT_CANCELLED } = require('../../Config/seatStatus');

const newId = () => new ObjectId().toHexString();
const tag = () => crypto.randomBytes(4).toString('hex');

const settingsFor = (userId) => ({
    userId,
    before: { key: 'before', items: [] },
    project: { key: 'project', items: [{ key: 'project_name', browser: true, mobile: true, email: false }] },
    tasks: { key: 'tasks', items: [{ key: 'task_edit', browser: true, mobile: true, email: false }] },
    chat: { key: 'chat', items: [{ key: 'message_create', browser: true, mobile: true, email: false }] },
});

/* A user written straight to the database, with a live session so the notification pipeline
 * resolves their profile, and optionally a seat and leftover settings in a company. */
async function seedUser(client, { name, seatIn, seatStatus = SEAT_ACTIVE, settingsIn = [] }) {
    const userId = newId();
    await client.db('global').collection('users').insertOne({
        _id: new ObjectId(userId),
        Employee_Name: name,
        Employee_Email: `${name.toLowerCase().replace(/\s+/g, '.')}.${tag()}@e2e.alianhub.test`,
        isEmailVerified: true,
    });
    await client.db('global').collection('sessions').insertOne({ userId, lastActive: new Date() });
    if (seatIn) {
        await client.db(seatIn).collection('company_users').insertOne({ userId, status: seatStatus, roleType: 3, isDelete: false });
    }
    for (const companyId of settingsIn) {
        await client.db(companyId).collection('notifications_settings').insertOne(settingsFor(userId));
    }
    return userId;
}

async function ensureSettings(client, companyId, userId) {
    await client.db(companyId).collection('notifications_settings').updateOne(
        { userId },
        { $setOnInsert: settingsFor(userId) },
        { upsert: true },
    );
}

async function waitFor(read, { timeoutMs = 8000, intervalMs = 150 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await read();
        if (value || Date.now() > deadline) return value;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

const settle = (ms = 1500) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { SEAT_ACTIVE, SEAT_CANCELLED, newId, tag, seedUser, ensureSettings, waitFor, settle };
