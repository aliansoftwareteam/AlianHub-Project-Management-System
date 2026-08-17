/**
 * Pure rules for the company project-skills list.
 *
 * `slug` is the cross-system identity: projects store slugs, and the
 * central-dashboard ETL joins them against the same normalisation applied to a
 * bid's skill strings. Both sides must normalise identically or per-tech
 * reporting silently splits in two — hence a standalone, tested module.
 */

const MAX_SKILL_NAME = 60;
const MAX_SKILLS_PER_PROJECT = 15;

// "UI/UX Design" -> "ui-ux-design", "Node.js" -> "node-js"
const toSlug = (name) => String(name === undefined || name === null ? '' : name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')       // accents, so "Café" and "Cafe" agree
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const cleanName = (name) => String(name === undefined || name === null ? '' : name)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SKILL_NAME);

/**
 * Validate a name for add/rename. `ignoreKey` is the entry being renamed, so it
 * doesn't clash with itself. Duplicates are judged on slug, not name — "Node JS"
 * and "node.js" are one skill to every downstream join.
 */
const validateName = (name, existing, ignoreKey) => {
    const display = cleanName(name);
    if (display.length < 2) return { valid: false, reason: 'SKILL_NAME_TOO_SHORT' };

    const slug = toSlug(display);
    if (!slug) return { valid: false, reason: 'SKILL_NAME_INVALID' };

    const clash = (existing || []).some((s) => s.slug === slug && s.key !== ignoreKey);
    if (clash) return { valid: false, reason: 'SKILL_ALREADY_EXISTS' };

    return { valid: true, name: display, slug };
};

/**
 * Slugs a project may carry. Unknown or deactivated ones are dropped, not
 * rejected: an AI suggestion must never create vocabulary, and a save shouldn't
 * fail because someone deactivated a skill mid-edit.
 */
const filterSkillSlugs = (requested, settings) => {
    const active = new Set((settings || []).filter((s) => s.active !== false).map((s) => s.slug));
    const seen = new Set();
    const kept = [];
    for (const raw of Array.isArray(requested) ? requested : []) {
        const slug = toSlug(raw);
        if (!slug || seen.has(slug) || !active.has(slug)) continue;
        seen.add(slug);
        kept.push(slug);
        if (kept.length === MAX_SKILLS_PER_PROJECT) break;
    }
    return kept;
};

module.exports = {
    MAX_SKILL_NAME,
    MAX_SKILLS_PER_PROJECT,
    toSlug,
    cleanName,
    validateName,
    filterSkillSlugs,
};
