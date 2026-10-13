'use strict';

const logger = require('../../Config/loggerConfig');
const projectSetup = require('../Agents/projectSetup');
const { VIEW_KINDS } = require('../Agents/setupRequests');
const { whoOf } = require('../Agents/taskRequests');

const listOf = (value) => (Array.isArray(value) ? value : []);
const TOO_MANY = `a plan holds at most ${projectSetup.VIEWS_MAX} views`;

/* Only for a reason that came without a code (an older caller, or a failure nobody named): read it from the English text. */
const REASON_CODES = Object.freeze([
    ['too_many', /^a plan holds at most/],
    ['permission', /permission_denied|may not make this part|is not granted/],
    ['name_taken', /named twice|already has a saved view named|already exists/i],
    ['name_missing', /needs a name/],
    ['kind', /needs a kind|kind of view must be/],
    ['no_source', /view to start from/],
    ['look', /groupBy|sortBy|sortDirection|due|range of days|shows "/],
]);

const reasonCode = (reason) => (REASON_CODES.find(([, pattern]) => pattern.test(String(reason || ''))) || ['other'])[0];
const withCode = (name, reason, code) => ({ name, reason, code: code || reasonCode(reason) });

const tabKeyOf = (kind) => String(VIEW_KINDS[kind] || '').toLowerCase();

/* The problem's message names the view by its place among those kept so far; the screen names it apart. */
const withoutPlace = (message, at, name) => {
    const place = `views[${at}]${name ? ` (${name})` : ''}`;
    return message.startsWith(place) ? message.slice(place.length).replace(/^:? /, '') : message;
};

/* The views a plan may ask for, each held to the check a connected AI's plan gets, and kept in the shape that is made;
 * one that fails is dropped with the reason. */
const trimViews = (given) => {
    const kept = [];
    const dropped = [];
    for (const entry of listOf(given)) {
        const view = projectSetup.viewOf(entry);
        const problem = kept.length >= projectSetup.VIEWS_MAX
            ? { code: 'too_many', message: TOO_MANY }
            : projectSetup.viewsProblemOf({ views: [...kept, entry] });
        if (problem.message) dropped.push(withCode(view.name, withoutPlace(problem.message, kept.length, view.name), problem.code));
        else kept.push(view);
    }
    return { kept, dropped };
};

/* A saved view starts as a copy of the project's own tab of that kind, so each kind a kept view uses needs its tab on the project. */
const tabKeysFor = (views) => new Set(trimViews(views).kept.map((view) => tabKeyOf(view.kind)).filter(Boolean));

const notMadeOf = (parts, plan) => parts.flatMap((part) => (part.error
    ? plan.views.map((view) => withCode(view.name, part.error, part.code))
    : listOf(part.items).filter((item) => item.error).map((item) => withCode(item.name, item.error, item.code))));

/* The views made in a project that exists, as the person who ran the generator; nothing here throws, so a view that fails never undoes the project. */
const makeViews = async ({ companyId, uid, projectId, views }) => {
    const { kept } = trimViews(views);
    if (!kept.length) return { made: [], notMade: [] };
    const plan = projectSetup.planOf({ views: kept });
    try {
        const parts = await projectSetup.carryOut({ companyId, who: whoOf({ kind: 'human', userId: uid }), projectId, plan });
        return {
            made: parts.flatMap((part) => listOf(part.items)).filter((item) => item.made).map((item) => ({ name: item.name, kind: item.kind })),
            notMade: notMadeOf(parts, plan),
        };
    } catch (error) {
        logger.warn(`[AIPG] views not made in ${projectId}: ${error && error.message ? error.message : error}`);
        return { made: [], notMade: plan.views.map((view) => withCode(view.name, error.message, 'other')) };
    }
};

module.exports = { trimViews, tabKeysFor, tabKeyOf, makeViews, reasonCode };
