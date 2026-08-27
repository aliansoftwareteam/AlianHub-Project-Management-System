const mongoose = require('mongoose');
const {
    idString,
    commentRoomPrefix,
    serializeCommentForSocket,
    incomingCommentDoc,
    acceptIncomingComment,
    mongoIdIn,
} = require('../Modules/Comments/helpers/commentThread');
const helper = require('../socket/helper');
const { handleCommentChange } = require('../socket/controller/commentSocket');
const { emitCommentInsert } = require('../Modules/Comments/helpers/alianReply');
const { buildAlianComment } = require('../Modules/Comments/helpers/alianMention');
const fs = require('fs');
const path = require('path');

const PID = '64a'.repeat(8);
const SID = '64b'.repeat(8);
const TID = '64c'.repeat(8);
const HEX_ID = /^[0-9a-fA-F]{24}$/;

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
        expect(idString('[object Object]')).toBe('');
        expect(idString({ type: 'Buffer', data: [...Buffer.from(PID, 'hex')] })).toBe(PID);
        expect(idString({ _bsontype: 'ObjectId', id: Buffer.from(PID, 'hex') })).toBe(PID);
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

    test('room prefix and payload never contain [object Object]', () => {
        const garbage = commentRoomPrefix({
            projectId: PID,
            sprintId: SID,
            taskId: '[object Object]',
        });
        expect(JSON.stringify(garbage)).not.toContain('[object Object]');
        expect(garbage.prefix).toBe(`comments_project_${PID}`);

        const mixed = serializeCommentForSocket({
            _id: { $oid: '64d'.repeat(8) },
            userId: 'alian',
            projectId: { $oid: PID },
            sprintId: { nope: true },
            taskId: { nope: true },
            message: 'hi',
        }, {
            projectId: PID,
            sprintId: SID,
            taskId: { $oid: TID },
        });
        expect(mixed.projectId).toBe(PID);
        expect(mixed.sprintId).toBe(SID);
        expect(mixed.taskId).toBe(TID);
        expect(mixed._id).toBe('64d'.repeat(8));
        expect(JSON.stringify(mixed)).not.toContain('[object Object]');
        expect(commentRoomPrefix(mixed).prefix).toBe(`comments_${PID}_${SID}_${TID}`);
    });

    test('alian follow-ups are accepted as live inserts', () => {
        expect(acceptIncomingComment({ _id: 'c2', userId: 'alian', message: 'hi' })).toBe(true);
        expect(incomingCommentDoc({ fullDocument: { userId: 'alian' } })).toEqual({ userId: 'alian' });
        expect(acceptIncomingComment(null)).toBe(false);
    });

    test('mongoIdIn matches string or ObjectId and leaves default as a string', () => {
        const match = mongoIdIn(TID);
        expect(match.$in).toContain(TID);
        expect(match.$in.some((id) => id && id.toHexString && id.toHexString() === TID)).toBe(true);
        expect(mongoIdIn('default')).toBe('default');
        expect(mongoIdIn('')).toBe(null);
        expect(mongoIdIn(null)).toBe(null);
        const comments = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Comments', 'controller.js'), 'utf8');
        expect(comments).toContain('mongoIdIn(projectId)');
        expect(comments).toContain('A valid projectId is required.');
        expect(comments).toContain('status(400)');
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
        expect(emitted[0].payload.fullDocument.projectId).toBe(PID);
        expect(emitted[0].payload.fullDocument.sprintId).toBe(SID);
        expect(emitted[0].payload.fullDocument.taskId).toBe(TID);
        expect(JSON.stringify(emitted)).not.toContain('[object Object]');
    });

    test('commentSocket does not interpolate raw Mixed ids into the prefix', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'socket', 'controller', 'commentSocket.js'), 'utf8');
        expect(src).toContain('serializeCommentForSocket(changeData.data)');
        expect(src).toContain('commentRoomPrefix(data)');
        expect(src).not.toMatch(/comments_\$\{.*projectId.*sprintId.*taskId/);
        expect(src).not.toContain('comments_project_${changeData.data.projectId}');
    });
});

describe('emitCommentInsert id contract', () => {
    function joinTaskRoom() {
        const roomName = `comments_${PID}_${SID}_${TID}**sock1`;
        const emitted = [];
        const namespace = {
            to: (room) => ({
                emit: (event, payload) => emitted.push({ room, event, payload }),
            }),
        };
        const socket = { id: 'sock1', disconnected: false, rooms: new Set([roomName]) };
        helper.upsertRoom({ roomName, socketId: 'sock1', socket, namespace });
        return { roomName, emitted };
    }

    test('copies missing sprintId/taskId from the triggering comment and emits hex strings', () => {
        const { roomName, emitted } = joinTaskRoom();
        const cid = '64e'.repeat(8);
        emitCommentInsert({
            _id: { $oid: cid },
            userId: 'alian',
            projectId: { $oid: PID },
            message: 'Ship the brief.',
        }, {
            _id: 'c1',
            userId: 'u1',
            projectId: new mongoose.Types.ObjectId(PID),
            sprintId: new mongoose.Types.ObjectId(SID),
            taskId: { $oid: TID },
        });

        expect(emitted).toHaveLength(1);
        expect(emitted[0].room).toBe(roomName);
        expect(emitted[0].event).toBe('commentInsert');
        const doc = emitted[0].payload.fullDocument;
        expect(doc._id).toBe(cid);
        expect(doc.projectId).toBe(PID);
        expect(doc.sprintId).toBe(SID);
        expect(doc.taskId).toBe(TID);
        expect(HEX_ID.test(doc.projectId)).toBe(true);
        expect(HEX_ID.test(doc.sprintId)).toBe(true);
        expect(HEX_ID.test(doc.taskId)).toBe(true);
        expect(JSON.stringify(emitted)).not.toContain('[object Object]');
    });

    test('Mixed ObjectId-shaped taskId does not fan out to comments_[object Object]', () => {
        const { roomName, emitted } = joinTaskRoom();
        emitCommentInsert({
            _id: new mongoose.Types.ObjectId('64f'.repeat(8)),
            userId: 'alian',
            projectId: new mongoose.Types.ObjectId(PID),
            sprintId: { type: 'Buffer', data: [...Buffer.from(SID, 'hex')] },
            taskId: { id: Buffer.from(TID, 'hex') },
            message: 'Ship it.',
        });

        expect(emitted).toHaveLength(1);
        expect(emitted[0].room).toBe(roomName);
        const doc = emitted[0].payload.fullDocument;
        expect(doc.projectId).toBe(PID);
        expect(doc.sprintId).toBe(SID);
        expect(doc.taskId).toBe(TID);
        expect(JSON.stringify(emitted)).not.toContain('[object Object]');
    });

    test('buildAlianComment stores hex thread ids from ObjectId source fields', () => {
        const built = buildAlianComment({
            _id: new mongoose.Types.ObjectId('64d'.repeat(8)),
            userId: 'u1',
            projectId: new mongoose.Types.ObjectId(PID),
            sprintId: new mongoose.Types.ObjectId(SID),
            taskId: new mongoose.Types.ObjectId(TID),
            message: '@Alian what is next?',
        }, 'Ship the brief.', []);
        expect(built.projectId).toBe(PID);
        expect(built.sprintId).toBe(SID);
        expect(built.taskId).toBe(TID);
        expect(built.reply_id).toBe('64d'.repeat(8));
        expect(JSON.stringify(built)).not.toContain('[object Object]');
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
