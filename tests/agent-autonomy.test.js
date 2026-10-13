const registry = require('../Modules/Agents/registry');

describe('autonomy ladder — the registry matches what the product says', () => {
    it('L1 "Suggest" proposes everything, even low-risk actions', () => {
        expect(registry.mayActDirectly(1, 'subtask.create')).toBe(false);
        expect(registry.mayActDirectly(1, 'task.comment')).toBe(false);
    });
    it('L2 "Act in bounds" acts on low and medium risk, never on gated or propose-only actions', () => {
        expect(registry.mayActDirectly(2, 'subtask.create')).toBe(true);
        expect(registry.mayActDirectly(2, 'task.update')).toBe(true);
        expect(registry.mayActDirectly(2, 'deploy.staging')).toBe(false);
    });
    it('L0 acts on nothing', () => {
        expect(registry.mayActDirectly(0, 'task.comment')).toBe(false);
    });
});
