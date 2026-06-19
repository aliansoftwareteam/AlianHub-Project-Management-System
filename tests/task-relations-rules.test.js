/**
 * Task Relation Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/Tasks/helpers/taskMongo/relationRules.js — the pure
 * rules module behind POST /api/v2/tasks/relations. No DB or network needed.
 */

const {
    RELATION_TYPES,
    RELATION_TYPE_LIST,
    INVERSE_RELATION,
    RELATION_LABELS,
    isObjectIdString,
    isClosedStatusType,
    selectOpenBlockers,
    validateTaskRef,
    validateRelationPair,
    validateRelationInput,
} = require('../Modules/Tasks/helpers/taskMongo/relationRules');

const VALID_ID_A = '64b7f0c2a1b2c3d4e5f60718';
const VALID_ID_B = '64b7f0c2a1b2c3d4e5f60719';
const COMPANY_ID = '64b7f0c2a1b2c3d4e5f60700';

describe('🔗 TASK RELATIONS - Rules', () => {

    describe('Relation type definitions', () => {

        test('every relation type has an inverse', () => {
            RELATION_TYPE_LIST.forEach((type) => {
                expect(INVERSE_RELATION[type]).toBeDefined();
                expect(RELATION_TYPE_LIST).toContain(INVERSE_RELATION[type]);
            });
        });

        test('inverse of the inverse is the original type (symmetry)', () => {
            RELATION_TYPE_LIST.forEach((type) => {
                expect(INVERSE_RELATION[INVERSE_RELATION[type]]).toBe(type);
            });
        });

        test('blocks <-> blocked_by and duplicates <-> duplicated_by are paired', () => {
            expect(INVERSE_RELATION[RELATION_TYPES.BLOCKS]).toBe(RELATION_TYPES.BLOCKED_BY);
            expect(INVERSE_RELATION[RELATION_TYPES.BLOCKED_BY]).toBe(RELATION_TYPES.BLOCKS);
            expect(INVERSE_RELATION[RELATION_TYPES.DUPLICATES]).toBe(RELATION_TYPES.DUPLICATED_BY);
            expect(INVERSE_RELATION[RELATION_TYPES.DUPLICATED_BY]).toBe(RELATION_TYPES.DUPLICATES);
        });

        test('relates_to is its own inverse (symmetric relation)', () => {
            expect(INVERSE_RELATION[RELATION_TYPES.RELATES_TO]).toBe(RELATION_TYPES.RELATES_TO);
        });

        test('every relation type has a human-readable label', () => {
            RELATION_TYPE_LIST.forEach((type) => {
                expect(typeof RELATION_LABELS[type]).toBe('string');
                expect(RELATION_LABELS[type].length).toBeGreaterThan(0);
            });
        });
    });

    describe('isObjectIdString', () => {

        test('accepts a 24-char hex string', () => {
            expect(isObjectIdString(VALID_ID_A)).toBe(true);
        });

        test('rejects short strings, non-hex, null, and undefined', () => {
            expect(isObjectIdString('123')).toBe(false);
            expect(isObjectIdString('zzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false);
            expect(isObjectIdString(null)).toBe(false);
            expect(isObjectIdString(undefined)).toBe(false);
        });
    });

    describe('validateTaskRef', () => {

        test('valid companyId + taskId passes', () => {
            const result = validateTaskRef({ companyId: COMPANY_ID, taskId: VALID_ID_A });
            expect(result.valid).toBe(true);
        });

        test('missing companyId fails', () => {
            const result = validateTaskRef({ companyId: '', taskId: VALID_ID_A });
            expect(result.valid).toBe(false);
            expect(result.reason).toMatch(/companyId/);
        });

        test('invalid taskId fails', () => {
            const result = validateTaskRef({ companyId: COMPANY_ID, taskId: 'not-an-id' });
            expect(result.valid).toBe(false);
            expect(result.reason).toMatch(/taskId/);
        });
    });

    describe('validateRelationPair', () => {

        test('two distinct valid ids pass', () => {
            const result = validateRelationPair({ companyId: COMPANY_ID, taskId: VALID_ID_A, relatedTaskId: VALID_ID_B });
            expect(result.valid).toBe(true);
        });

        test('invalid relatedTaskId fails', () => {
            const result = validateRelationPair({ companyId: COMPANY_ID, taskId: VALID_ID_A, relatedTaskId: 'nope' });
            expect(result.valid).toBe(false);
            expect(result.reason).toMatch(/relatedTaskId/);
        });

        test('a task cannot be linked to itself', () => {
            const result = validateRelationPair({ companyId: COMPANY_ID, taskId: VALID_ID_A, relatedTaskId: VALID_ID_A });
            expect(result.valid).toBe(false);
            expect(result.reason).toMatch(/itself/);
        });
    });

    describe('validateRelationInput', () => {

        test('valid pair + every known type passes', () => {
            RELATION_TYPE_LIST.forEach((type) => {
                const result = validateRelationInput({ companyId: COMPANY_ID, taskId: VALID_ID_A, relatedTaskId: VALID_ID_B, type });
                expect(result.valid).toBe(true);
            });
        });

        test('unknown relation type fails and lists the allowed types', () => {
            const result = validateRelationInput({ companyId: COMPANY_ID, taskId: VALID_ID_A, relatedTaskId: VALID_ID_B, type: 'depends_on' });
            expect(result.valid).toBe(false);
            expect(result.reason).toMatch(/depends_on/);
            expect(result.reason).toMatch(/blocks/);
        });

        test('missing type fails', () => {
            const result = validateRelationInput({ companyId: COMPANY_ID, taskId: VALID_ID_A, relatedTaskId: VALID_ID_B });
            expect(result.valid).toBe(false);
        });

        test('pair-level failures surface through the full validator', () => {
            const result = validateRelationInput({ companyId: COMPANY_ID, taskId: VALID_ID_A, relatedTaskId: VALID_ID_A, type: RELATION_TYPES.BLOCKS });
            expect(result.valid).toBe(false);
            expect(result.reason).toMatch(/itself/);
        });
    });

    describe('isClosedStatusType', () => {

        test('only "close" counts as closed', () => {
            expect(isClosedStatusType('close')).toBe(true);
            expect(isClosedStatusType('open')).toBe(false);
            expect(isClosedStatusType('')).toBe(false);
            expect(isClosedStatusType(undefined)).toBe(false);
        });
    });

    describe('selectOpenBlockers', () => {

        const blockerItem = (overrides = {}) => ({
            taskId: VALID_ID_B,
            type: RELATION_TYPES.BLOCKED_BY,
            task: { TaskKey: 'AH-2', statusType: 'open', deletedStatusKey: 0 },
            ...overrides,
        });

        test('an open blocked_by link counts as an open blocker', () => {
            expect(selectOpenBlockers([blockerItem()])).toHaveLength(1);
        });

        test('a closed blocker does NOT count', () => {
            const item = blockerItem({ task: { TaskKey: 'AH-2', statusType: 'close', deletedStatusKey: 0 } });
            expect(selectOpenBlockers([item])).toHaveLength(0);
        });

        test('a soft-deleted blocker is ignored', () => {
            const item = blockerItem({ task: { TaskKey: 'AH-2', statusType: 'open', deletedStatusKey: 1 } });
            expect(selectOpenBlockers([item])).toHaveLength(0);
        });

        test('only blocked_by links count — blocks / relates_to / duplicates do not', () => {
            const items = [
                blockerItem({ type: RELATION_TYPES.BLOCKS }),
                blockerItem({ type: RELATION_TYPES.RELATES_TO }),
                blockerItem({ type: RELATION_TYPES.DUPLICATES }),
            ];
            expect(selectOpenBlockers(items)).toHaveLength(0);
        });

        test('an item with no resolved task is skipped', () => {
            expect(selectOpenBlockers([blockerItem({ task: null })])).toHaveLength(0);
        });

        test('empty / nullish input returns []', () => {
            expect(selectOpenBlockers([])).toEqual([]);
            expect(selectOpenBlockers(null)).toEqual([]);
            expect(selectOpenBlockers(undefined)).toEqual([]);
        });

        test('a mixed list returns only the open blockers', () => {
            const items = [
                blockerItem(),
                blockerItem({ task: { TaskKey: 'AH-3', statusType: 'close', deletedStatusKey: 0 } }),
                blockerItem({ type: RELATION_TYPES.BLOCKS }),
            ];
            expect(selectOpenBlockers(items)).toHaveLength(1);
        });
    });
});
