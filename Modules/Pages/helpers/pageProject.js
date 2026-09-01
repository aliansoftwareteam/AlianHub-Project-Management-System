'use strict';

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { firstId } = require('../../Project/helpers/taskOpenProjectId');
const { isObjectIdString } = require('./pageRules');

function asPlainPage(page) {
    if (!page || typeof page !== 'object') return null;
    const row = typeof page.toObject === 'function' ? page.toObject() : { ...page };
    const raw = firstId(
        row.ProjectID,
        row.projectId,
        row.ProjectId,
        page.ProjectID,
        page.projectId,
        page.ProjectId,
    );
    if (raw) {
        row.ProjectID = raw;
        row.projectId = raw;
    }
    return row;
}

function stampPageProject(row, pid) {
    const id = firstId(pid);
    if (!row || typeof row !== 'object' || !id) return row;
    row.ProjectID = id;
    row.projectId = id;
    return row;
}

function linkedTaskId(row) {
    const list = row && row.linkedTasks;
    if (!Array.isArray(list) || !list.length) return '';
    const tid = firstId(list[0]);
    return isObjectIdString(tid) ? tid : '';
}

async function attachProjectsToPages(companyId, pages) {
    const rows = (Array.isArray(pages) ? pages : []).map(asPlainPage).filter(Boolean);
    const missing = rows.filter((row) => !firstId(row.ProjectID, row.projectId) && linkedTaskId(row));
    if (!missing.length) return rows;

    const ids = [...new Set(missing.map(linkedTaskId))];
    const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
    const tasks = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: { $in: objectIds } }],
    }, 'find') || [];
    const byTask = {};
    for (const task of tasks) {
        const tid = firstId(task && (task._id || task.id));
        const pid = firstId(task && (task.ProjectID || task.projectId || task.ProjectId));
        if (tid && pid) byTask[tid] = pid;
    }
    for (const row of missing) {
        stampPageProject(row, byTask[linkedTaskId(row)]);
    }
    return rows;
}

module.exports = {
    asPlainPage,
    stampPageProject,
    linkedTaskId,
    attachProjectsToPages,
};
