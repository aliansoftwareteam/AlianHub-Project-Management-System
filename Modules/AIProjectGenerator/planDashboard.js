'use strict';

const logger = require('../../Config/loggerConfig');
const projectSetup = require('../Agents/projectSetup');
const boards = require('../Agents/dashboardRequests');
const { whoOf } = require('../Agents/taskRequests');

const listOf = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/* The plan's dashboard as a connected AI's plan holds one: a card the picker does not add as it is, or a card past
 * six, is left out rather than the dashboard; one with no name or no card left is dropped with the reason's code. */
const trimDashboard = (given) => {
    if (!isRecord(given)) return { kept: null, dropped: null };
    const draft = boards.planDashboardOf({ ...given, cards: listOf(given.cards).filter((card) => Object.hasOwn(boards.CARDS, String(card))) });
    const cards = draft.cards.slice(0, boards.PLAN_CARDS_MAX);
    if (!draft.name) return { kept: null, dropped: { name: '', code: 'name_missing' } };
    if (!cards.length) return { kept: null, dropped: { name: draft.name, code: 'no_cards' } };
    return { kept: { name: draft.name, cards, cardKeys: cards.map((card) => boards.CARDS[card].key) }, dropped: null };
};

/* The dashboard made for a project that exists, as the person who ran the generator; nothing here throws, so a
 * dashboard that fails never undoes the project. */
const makeDashboard = async ({ companyId, uid, projectId, dashboard }) => {
    const { kept } = trimDashboard(dashboard);
    if (!kept) return null;
    const plan = projectSetup.planOf({ dashboard: kept });
    try {
        const [part] = await projectSetup.carryOut({ companyId, who: whoOf({ kind: 'human', userId: uid }), projectId, plan });
        const item = listOf(part && part.items)[0];
        if (item && item.made) return { name: item.name, made: true, shared: item.shared === true };
        return { name: kept.name, made: false, reason: (item && item.error) || (part && part.error) || '' };
    } catch (error) {
        logger.warn(`[AIPG] dashboard not made in ${projectId}: ${error && error.message ? error.message : error}`);
        return { name: kept.name, made: false, reason: error.message };
    }
};

module.exports = { trimDashboard, makeDashboard };
