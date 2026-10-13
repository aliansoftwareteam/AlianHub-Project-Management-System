'use strict';

const logger = require('../../Config/loggerConfig');
const projectSetup = require('../Agents/projectSetup');
const { VIEW_KINDS } = require('../Agents/setupRequests');
const { whoOf } = require('../Agents/taskRequests');

const listOf = (value) => (Array.isArray(value) ? value : []);
const TOO_MANY = `a plan holds at most ${projectSetup.VIEWS_MAX} views`;
const WHERE = /^views\[\d+\](?: \(.*?\))?:? /;

/* The views a plan may ask for, each held to the check a connected AI's plan gets; one that fails is dropped with the reason. */
const trimViews = (given) => {
    const kept = [];
    const dropped = [];
    for (const entry of listOf(given)) {
        const name = projectSetup.viewOf(entry).name;
        const problem = kept.length >= projectSetup.VIEWS_MAX ? TOO_MANY : projectSetup.planProblem({ views: [...kept, entry] });
        if (problem) dropped.push({ name, reason: problem.replace(WHERE, '') });
        else kept.push(entry);
    }
    return { kept, dropped };
};

/* A saved view starts as a copy of the project's own tab of that kind, so each kind a kept view uses needs its tab on the project. */
const tabKeysFor = (views) => new Set(trimViews(views).kept
    .map((view) => VIEW_KINDS[projectSetup.viewOf(view).kind])
    .filter(Boolean)
    .map((keyName) => keyName.toLowerCase()));

/* The views made in a project that exists, as the person who ran the generator; nothing here throws, so a view that fails never undoes the project. */
const makeViews = async ({ companyId, uid, projectId, views }) => {
    const { kept } = trimViews(views);
    if (!kept.length) return { made: [], notMade: [] };
    const plan = projectSetup.planOf({ views: kept });
    try {
        const parts = await projectSetup.carryOut({ companyId, who: whoOf({ kind: 'human', userId: uid }), projectId, plan });
        return {
            made: parts.flatMap((part) => part.items).filter((item) => item.made).map((item) => ({ name: item.name, kind: item.kind })),
            notMade: projectSetup.notMadeIn(parts, plan).map((entry) => ({ name: entry.name, reason: entry.error })),
        };
    } catch (error) {
        logger.warn(`[AIPG] views not made in ${projectId}: ${error && error.message ? error.message : error}`);
        return { made: [], notMade: plan.views.map((view) => ({ name: view.name, reason: error.message })) };
    }
};

module.exports = { trimViews, tabKeysFor, makeViews };
