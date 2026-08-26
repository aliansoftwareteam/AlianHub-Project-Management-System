const mongoose = require('mongoose');
const {
    idString,
    commentRoomPrefix,
    serializeCommentForSocket,
    incomingCommentDoc,
    acceptIncomingComment,
} = require('../Modules/Comments/helpers/commentThread');
const helper = require('../socket/helper');
const { handleCommentChange } = require('../socket/controller/commentSocket');
const fs = require('fs');
const path = require('path');

const PID = '64a'.repeat(8);
const SID = '64b'.repeat(8);
const TID = '64c'.repeat(8);

beforeEach(() => {
    const { byPrefix, bySocket } = helper.__internals;
    byPrefix.clear();
    bySocket.clear();
});

describe('comment thread id contract', () => {
    test('idString turns ObjectIds, $oid wrappers and buffers into hex', () => {
        const oid = new mongoose.Types.ObjectId(PID);
        expect(idString(oid)).toBe(PID);
        expect(idString(PID)).toBe(PID);
        expect(idString({ $oid: PID })).toBe(PID);
        expect(idString(Buffer.from(PID, 'hex'))).toBe(PID);
        expect(idString({ id: Buffer.from(PID, 'hex') })).toBe(PID);
        expect(idString(null)).toBe('');
        expect(idString({ nope: true })).toBe('');
    });

    test('task room prefix is the same for ObjectIds and strings', () => {
        const fromIds = commentRoomPrefix({
            projectId: new mongoose.Types.ObjectId(PID),
            sprintId: new mongoose.Types.ObjectId(SID),
            taskId: new mongoose.Types.ObjectId(TID),
        });
        const fromStrings = commentRoomPrefix({
            projectId: PID,
            sprintId: SID,
            taskId: TID,
        });
        const fromOid = commentRoomPrefix({
            projectId: { $oid: PID },
            sprintId: { $oid: SID },
            taskId: { $oid: TID },
        });
        expect(fromIds).toEqual(fromStrings);
        expect(fromOid).toEqual(fromStrings);
        expect(fromStrings).toEqual({
            module: 'comments',
            prefix: `comments_${PID}_${SID}_${TID}`,
            projectId: PID,
            sprintId: SID,
            taskId: TID,
        });
    });

    test('main-chat default taskId stays on the comments_ room, not comments_project_', () => {
        expect(commentRoomPrefix({
            projectId: PID,
            sprintId: SID,
            taskId: 'default',
        })).toEqual({
            module: 'comments',
            prefix: `comments_${PID}_${SID}_default`,
            projectId: PID,
            sprintId: SID,
            taskId: 'default',
        });
    });

    test('serializeCommentForSocket writes stable string ids on the payload', () => {
        const saved = {
            _id: new mongoose.Types.ObjectId('64d'.repeat(8)),
            userId: 'alian',
            projectId: new mongoose.Types.ObjectId(PID),
            sprintId: new mongoose.Types.ObjectId(SID),
            taskId: new mongoose.Types.ObjectId(TID),
            message: 'Ship the brief.',
            citations: [{ type: 'page', id: 'p1', title: 'Handbook' }],
        };
        const payload = serializeCommentForSocket(saved);
        expect(payload.projectId).toBe(PID);
        expect(payload.sprintId).toBe(SID);
        expect(payload.taskId).toBe(TID);
        expect(payload._id).toBe('64d'.repeat(8));
        expect(payload.userId).toBe('alian');
        expect(commentRoomPrefix(payload).prefix).toBe(`comments_${PID}_${SID}_${TID}`);
    });

    test('serializeCommentForSocket fills missing thread ids from the source comment', () => {
        const source = {
            _id: 'c1',
            userId: 'u1',
            projectId: PID,
            sprintId: SID,
            taskId: TID,
        };
        const saved = { _id: 'c2', userId: 'alian', projectId: PID, message: 'hi' };
        const payload = serializeCommentForSocket(saved, source);
        expect(payload.sprintId).toBe(SID);
        expect(payload.taskId).toBe(TID);
        expect(commentRoomPrefix(payload).module).toBe('comments');
        expect(commentRoomPrefix(payload).prefix).toBe(`comments_${PID}_${SID}_${TID}`);
    });

    test('alian follow-ups are accepted as live inserts', () => {
        expect(acceptIncomingComment({ _id: 'c2', userId: 'alian', message: 'hi' })).toBe(true);
        expect(incomingCommentDoc({ fullDocument: { userId: 'alian' } })).toEqual({ userId: 'alian' });
        expect(acceptIncomingComment(null)).toBe(false);
    });
});

describe('commentSocket fan-out', () => {
    test('ObjectId payload reaches a room joined with string ids', () => {
        const roomName = `comments_${PID}_${SID}_${TID}**sock1`;
        const emitted = [];
        const namespace = {
            to: (room) => ({
                emit: (event, payload) => emitted.push({ room, event, payload }),
            }),
        };
        const socket = { id: 'sock1', disconnected: false, rooms: new Set([roomName]) };
        helper.upsertRoom({ roomName, socketId: 'sock1', socket, namespace });

        handleCommentChange({
            type: 'insert',
            module: 'comments',
            data: serializeCommentForSocket({
                _id: new mongoose.Types.ObjectId('64e'.repeat(8)),
                userId: 'alian',
                projectId: new mongoose.Types.ObjectId(PID),
                sprintId: new mongoose.Types.ObjectId(SID),
                taskId: new mongoose.Types.ObjectId(TID),
                message: 'Ship it.',
            }),
        });

        expect(emitted).toHaveLength(1);
        expect(emitted[0].room).toBe(roomName);
        expect(emitted[0].event).toBe('commentInsert');
        expect(emitted[0].payload.fullDocument.userId).toBe('alian');
        expect(emitted[0].payload.fullDocument.projectId).toBe(PID);
        expect(emitted[0].payload.fullDocument.taskId).toBe(TID);
    });

    test('raw ObjectId fields still match the string room prefix', () => {
        const roomName = `comments_${PID}_${SID}_${TID}**sock1`;
        const emitted = [];
        const namespace = {
            to: (room) => ({
                emit: (event, payload) => emitted.push({ room, event, payload }),
            }),
        };
        const socket = { id: 'sock1', disconnected: false, rooms: new Set([roomName]) };
        helper.upsertRoom({ roomName, socketId: 'sock1', socket, namespace });

        handleCommentChange({
            type: 'insert',
            module: 'comments',
            data: {
                userId: 'alian',
                projectId: new mongoose.Types.ObjectId(PID),
                sprintId: new mongoose.Types.ObjectId(SID),
                taskId: new mongoose.Types.ObjectId(TID),
            },
        });

        expect(emitted).toHaveLength(1);
        expect(emitted[0].event).toBe('commentInsert');
    });
});

describe('Comments.vue live insert', () => {
    test('does not skip userId alian and reads fullDocument or the payload', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'Projects', 'Comments', 'Comments.vue'), 'utf8');
        expect(src).not.toMatch(/userId\s*!==\s*['"]alian['"]/);
        expect(src).not.toMatch(/userId\s*===\s*['"]alian['"]\s*.*return/);
        expect(src).toContain('data.fullDocument || data');
        expect(src).toContain('upsertIncomingComment');
        expect(src).toContain("id === 'alian'");
    });
});
