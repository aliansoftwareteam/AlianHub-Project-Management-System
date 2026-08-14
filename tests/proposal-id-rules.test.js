/**
 * Project Proposal ID Test Suite
 * AlianHub Project Management System
 *
 * The projects schema is `strict: true`, so an undeclared field is silently
 * dropped on write — a saved proposal ID would toast success and persist
 * nothing. No DB needed: mongoose casts documents locally.
 */

const mongoose = require('mongoose');
const { schema } = require('../utils/mongo-handler/schema');
const { PlanSchema } = require('../Modules/AIProjectGenerator/schemaValidator');

describe('🔗 PROPOSAL ID - projects schema', () => {

    test('proposalId is declared as an optional string', () => {
        expect(schema.projects.proposalId).toEqual({
            type: String,
            required: false,
            default: '',
        });
    });

    test('a strict projects model keeps proposalId on write', () => {
        const model = mongoose.model(
            'proposalIdTestProjects',
            new mongoose.Schema(schema.projects, { strict: true, timestamps: true }),
        );
        const doc = new model({ ProjectName: 'Alian', proposalId: '1234567890' });
        expect(doc.proposalId).toBe('1234567890');
    });

    test('an untouched project defaults to an empty proposalId, not undefined', () => {
        const model = mongoose.model('proposalIdTestProjectsDefault',
            new mongoose.Schema(schema.projects, { strict: true, timestamps: true }));
        expect(new model({ ProjectName: 'Alian' }).proposalId).toBe('');
    });
});

describe('🔗 PROPOSAL ID - AI plan validation', () => {

    // controller.execute relies on zod dropping any LLM-emitted proposalId.
    // Adding it to ProjectSchema would silently break that — this catches it.
    const plan = (extra) => ({
        project: {
            ProjectName: 'Alian Portal',
            description: 'A project long enough to pass the minimum.',
            projectStatusData: [
                { name: 'Planning', type: 'default_active' },
                { name: 'Closed', type: 'close' },
            ],
            taskStatusData: [
                { name: 'To Do', type: 'default_active' },
                { name: 'Done', type: 'close' },
            ],
            taskTypeCounts: [{ name: 'Task' }],
            ...extra,
        },
        sprints: [{
            sprintName: 'Sprint 1',
            tasks: [{
                TaskName: 'Set up the repo',
                status: 'To Do',
                priority: 'Medium',
                descriptionBlocks: [
                    { type: 'paragraph', data: { text: 'Context for the task.' } },
                    { type: 'header', data: { text: 'What to do', level: 4 } },
                    { type: 'list', data: { style: 'ordered', items: ['Step one'] } },
                    { type: 'header', data: { text: 'Acceptance criteria', level: 4 } },
                    { type: 'list', data: { style: 'unordered', items: ['It works'] } },
                ],
            }],
        }],
    });

    test('a plan without a proposalId validates', () => {
        expect(PlanSchema.safeParse(plan()).success).toBe(true);
    });

    test('an LLM-supplied proposalId is stripped, not persisted', () => {
        const parsed = PlanSchema.safeParse(plan({ proposalId: 'hallucinated-999' }));
        expect(parsed.success).toBe(true);
        expect(parsed.data.project.proposalId).toBeUndefined();
    });
});
