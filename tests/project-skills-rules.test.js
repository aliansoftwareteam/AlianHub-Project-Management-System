/**
 * Project Skills Rules Test Suite
 * AlianHub Project Management System
 *
 * `slug` is the identity that crosses systems: projects store slugs and the
 * central dashboard joins them against normalised bid skills. If the two sides
 * ever normalise differently, per-tech reporting splits in two silently — so
 * the normalisation and the "only known, active slugs get stored" rule are
 * pinned here. No DB or network needed.
 */

const {
    toSlug,
    cleanName,
    validateName,
    filterSkillSlugs,
    MAX_SKILLS_PER_PROJECT,
} = require('../Modules/settings/ProjectSkills/skillRules');

describe('🧩 PROJECT SKILLS - slug normalisation', () => {

    test('punctuation and spacing collapse to single dashes', () => {
        expect(toSlug('Shopify App Development')).toBe('shopify-app-development');
        expect(toSlug('UI/UX Design')).toBe('ui-ux-design');
        expect(toSlug('Node.js')).toBe('node-js');
        expect(toSlug('.NET')).toBe('net');
    });

    test('leading and trailing separators are trimmed, not left dangling', () => {
        expect(toSlug('  --React--  ')).toBe('react');
        expect(toSlug('C++')).toBe('c');
    });

    test('accents fold, so an accented name cannot fork the vocabulary', () => {
        expect(toSlug('Café Ordering')).toBe(toSlug('Cafe Ordering'));
    });

    test('junk input yields an empty slug rather than a bogus one', () => {
        expect(toSlug('///')).toBe('');
        expect(toSlug('')).toBe('');
        expect(toSlug(null)).toBe('');
        expect(toSlug(undefined)).toBe('');
    });

    test('display names keep their formatting but lose runaway whitespace', () => {
        expect(cleanName('  Shopify   App  ')).toBe('Shopify App');
        expect(cleanName('a'.repeat(200))).toHaveLength(60);
    });
});

describe('🧩 PROJECT SKILLS - name validation', () => {

    const existing = [
        { key: 1, name: 'Node.js', slug: 'node-js', active: true },
        { key: 2, name: 'Shopify', slug: 'shopify', active: true },
    ];

    test('a fresh name passes and carries its slug', () => {
        expect(validateName('React Native', existing)).toEqual({
            valid: true, name: 'React Native', slug: 'react-native',
        });
    });

    test('duplicates are caught on slug, not on the typed name', () => {
        expect(validateName('node js', existing).reason).toBe('SKILL_ALREADY_EXISTS');
        expect(validateName('NODE.JS', existing).reason).toBe('SKILL_ALREADY_EXISTS');
        expect(validateName('  Shopify  ', existing).reason).toBe('SKILL_ALREADY_EXISTS');
    });

    test('renaming an entry does not collide with itself', () => {
        expect(validateName('Node JS', existing, 1).valid).toBe(true);
        // ...but it still collides with a different entry
        expect(validateName('Shopify', existing, 1).reason).toBe('SKILL_ALREADY_EXISTS');
    });

    test('too short or unusable names are rejected', () => {
        expect(validateName('x', existing).reason).toBe('SKILL_NAME_TOO_SHORT');
        expect(validateName('   ', existing).reason).toBe('SKILL_NAME_TOO_SHORT');
        expect(validateName('///', existing).reason).toBe('SKILL_NAME_INVALID');
    });
});

describe('🧩 PROJECT SKILLS - what a project is allowed to store', () => {

    const settings = [
        { key: 1, name: 'Shopify', slug: 'shopify', active: true },
        { key: 2, name: 'React', slug: 'react', active: true },
        { key: 3, name: 'Flash', slug: 'flash', active: false },
    ];

    test('known active slugs survive, in the order given', () => {
        expect(filterSkillSlugs(['react', 'shopify'], settings)).toEqual(['react', 'shopify']);
    });

    test('display names are normalised to slugs on the way in', () => {
        expect(filterSkillSlugs(['Shopify'], settings)).toEqual(['shopify']);
    });

    test('an unknown slug is dropped — an AI suggestion cannot create vocabulary', () => {
        expect(filterSkillSlugs(['react', 'kubernetes-wizardry'], settings)).toEqual(['react']);
    });

    test('deactivated skills cannot be newly assigned', () => {
        expect(filterSkillSlugs(['flash'], settings)).toEqual([]);
    });

    test('duplicates collapse', () => {
        expect(filterSkillSlugs(['react', 'React', 'react'], settings)).toEqual(['react']);
    });

    test(`no more than ${MAX_SKILLS_PER_PROJECT} skills are kept`, () => {
        const many = Array.from({ length: 40 }, (_, i) => ({
            key: i, name: `Skill ${i}`, slug: `skill-${i}`, active: true,
        }));
        const requested = many.map((s) => s.slug);
        expect(filterSkillSlugs(requested, many)).toHaveLength(MAX_SKILLS_PER_PROJECT);
    });

    test('junk input yields an empty list, never a crash', () => {
        expect(filterSkillSlugs(null, settings)).toEqual([]);
        expect(filterSkillSlugs(['', null, undefined, '///'], settings)).toEqual([]);
        expect(filterSkillSlugs(['react'], null)).toEqual([]);
    });
});

describe('🧩 PROJECT SKILLS - projects schema', () => {

    // `projects` is strict: true, so an undeclared field is dropped on write
    // and the save reports success having stored nothing.
    test('skills is declared as an optional array defaulting to empty', () => {
        const { schema } = require('../utils/mongo-handler/schema');
        expect(schema.projects.skills).toEqual({
            type: Array,
            required: false,
            default: [],
        });
    });

    test('the seeded starter list has unique, non-empty slugs', () => {
        // Guards the seed itself: two starter names colliding on slug would
        // make one of them permanently unassignable.
        const names = [
            'Shopify', 'Shopify App Development', 'WordPress', 'Webflow',
            'React', 'Vue.js', 'Angular', 'Node.js', 'Laravel', 'PHP',
            'Python', 'Django', '.NET', 'React Native', 'Flutter', 'iOS',
            'Android', 'UI/UX Design', 'Web Design', 'Graphic Design',
            'AI/ML', 'Data Engineering', 'DevOps', 'QA/Testing',
        ];
        const slugs = names.map(toSlug);
        expect(slugs.every(Boolean)).toBe(true);
        expect(new Set(slugs).size).toBe(names.length);
    });
});
