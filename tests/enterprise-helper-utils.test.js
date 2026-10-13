const mockStore = new Map();
const mockTtl = [];

jest.mock('../Config/config', () => ({
    myCache: {
        get: (key) => mockStore.get(key),
        set: (key, value, ttl) => { mockStore.set(key, value); mockTtl.push([key, ttl]); },
    },
}));

const helper = require('../utils/enterpriseHelper');
const aiPrompts = require('../utils/aiPrompts.json');
const aiCategories = require('../utils/aiCategories.json');
const aiModals = require('../utils/aiModals.json');
const projectTemplates = require('../utils/projectTemplates.json');

beforeEach(() => {
    mockStore.clear();
    mockTtl.length = 0;
});

describe('getCachedPromptData', () => {
    const title = aiPrompts[0].title;

    it('finds the prompt by title, with its predefined prompt intact', async () => {
        const out = await helper.getCachedPromptData({ query: [{ title }] });
        expect(out).toEqual({ status: true, statusText: aiPrompts[0] });
        expect(out.statusText.predefinedPrompt).toBe(aiPrompts[0].predefinedPrompt);
    });

    it('remembers the prompt for an hour under its title', async () => {
        await helper.getCachedPromptData({ query: [{ title }] });
        expect(mockTtl).toEqual([[title, 3600]]);
    });

    it('answers from the cache on the second ask, without touching the list again', async () => {
        mockStore.set(title, { title, cached: true });
        const out = await helper.getCachedPromptData({ query: [{ title }] });
        expect(out).toEqual({ status: true, statusText: { title, cached: true } });
        expect(mockTtl).toEqual([]);
    });

    it('reports a missing prompt without caching the miss', async () => {
        const out = await helper.getCachedPromptData({ query: [{ title: 'No such prompt' }] });
        expect(out).toEqual({ status: false, statusText: 'No Prompt Found' });
        expect(mockStore.has('No such prompt')).toBe(false);
    });

    it('matches the title exactly, not by case or substring', async () => {
        expect((await helper.getCachedPromptData({ query: [{ title: title.toUpperCase() + 'x' }] })).status).toBe(false);
        expect((await helper.getCachedPromptData({ query: [{ title: title.slice(0, 3) }] })).status).toBe(false);
    });

    it('treats an empty title as not found', async () => {
        const out = await helper.getCachedPromptData({ query: [{ title: '' }] });
        expect(out.status).toBe(false);
    });

    it('rejects when the request carries no query', async () => {
        await expect(helper.getCachedPromptData({})).rejects.toBeInstanceOf(TypeError);
        await expect(helper.getCachedPromptData({ query: [] })).rejects.toBeInstanceOf(TypeError);
        await expect(helper.getCachedPromptData(undefined)).rejects.toBeInstanceOf(TypeError);
    });
});

describe('getCachedAllPromptData', () => {
    it('lists every prompt without the predefined prompt text', async () => {
        const out = await helper.getCachedAllPromptData();
        expect(out.status).toBe(true);
        expect(out.statusText).toHaveLength(aiPrompts.length);
        out.statusText.forEach((row) => expect(row).not.toHaveProperty('predefinedPrompt'));
        expect(out.statusText[0]).toMatchObject({ title: aiPrompts[0].title, categoryRef: aiPrompts[0].categoryRef });
    });

    it('keeps the source list unchanged', async () => {
        await helper.getCachedAllPromptData();
        expect(aiPrompts[0]).toHaveProperty('predefinedPrompt');
    });

    it('caches the stripped list for an hour and serves it next time', async () => {
        const first = await helper.getCachedAllPromptData();
        expect(mockTtl).toEqual([['getAllPrompt', 3600]]);
        const second = await helper.getCachedAllPromptData();
        expect(second.statusText).toBe(first.statusText);
        expect(mockTtl).toHaveLength(1);
    });
});

describe.each([
    ['getCachedCategoryData', 'getCategory', aiCategories],
    ['getCachedAiModelData', 'getModel', aiModals],
    ['getCachedGlobalTemplateData', 'getTemplateData', projectTemplates],
])('%s', (fn, cacheKey, source) => {
    it('returns the whole list', async () => {
        expect(await helper[fn]()).toEqual({ status: true, statusText: source });
    });

    it('caches it for an hour', async () => {
        await helper[fn]();
        expect(mockTtl).toEqual([[cacheKey, 3600]]);
    });

    it('serves the cached copy without caching again', async () => {
        mockStore.set(cacheKey, ['cached']);
        expect(await helper[fn]()).toEqual({ status: true, statusText: ['cached'] });
        expect(mockTtl).toEqual([]);
    });
});

describe('cache failures', () => {
    it('reject instead of hanging when the cache throws', async () => {
        const { myCache } = require('../Config/config');
        const original = myCache.get;
        myCache.get = () => { throw new Error('cache gone'); };
        try {
            await expect(helper.getCachedCategoryData()).rejects.toThrow('cache gone');
            await expect(helper.getCachedAllPromptData()).rejects.toThrow('cache gone');
        } finally {
            myCache.get = original;
        }
    });
});
