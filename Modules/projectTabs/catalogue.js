const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");

const view = (name, sortIndex, keyName, value) => Object.freeze({ name, sortIndex, keyName, value, setAsDefault: false, viewStatus: false });

const VIEW_CATALOGUE = Object.freeze([
    view("List", 1, "ProjectListView", "list"),
    view("Board", 2, "ProjectKanban", "ProjectKanban"),
    view("Project Details", 3, "ProjectDetail", "projectDetails"),
    view("Comments", 4, "Comments", "comments"),
    view("Calendar", 5, "Calendar", "calendar"),
    view("Activity", 6, "ActivityLog", "activitylog"),
    view("Workload", 7, "Workload", "workload"),
    view("Dashboard", 8, "ProjectDashboard", "dashboard"),
    view("Table", 9, "TableView", "TableView"),
    view("Embed", 11, "Embed", "embed"),
    view("Reports", 12, "Reports", "reports"),
    view("Gantt View", 12, "GanttView", "ganttview"),
    view("Recurring Tasks", 12, "RecurringTasks", "recurringtasks"),
    view("Timeline View", 12, "TimelineView", "timelineview"),
    view("Mind Map View", 13, "MindMapView", "mindmapview"),
    view("Whiteboard View", 14, "WhiteboardView", "whiteboardview"),
    view("Canvas View", 15, "CanvasView", "canvasview"),
    view("Map View", 16, "MapView", "mapview"),
    view("Docs", 17, "DocsView", "docsview"),
    view("Forms", 20, "FormsView", "formsview"),
]);

const missingViews = (rows) => {
    const stored = new Set((Array.isArray(rows) ? rows : []).map((row) => row && row.keyName));
    return VIEW_CATALOGUE.filter((entry) => !stored.has(entry.keyName));
};

const findViews = (companyId, crud = MongoDbCrudOpration) => crud(companyId, { type: SCHEMA_TYPE.PROJECT_TAB_COMPONENTS, data: [{}] }, "find");

/* Upserts by keyName with $setOnInsert, so a row the company already has keeps its id,
 * name and sortIndex: project view entries and renames point at those. */
async function addMissingViews(companyId, crud = MongoDbCrudOpration) {
    const missing = missingViews(await findViews(companyId, crud));
    const settled = await Promise.allSettled(missing.map((entry) => crud(companyId, {
        type: SCHEMA_TYPE.PROJECT_TAB_COMPONENTS,
        data: [{ keyName: entry.keyName }, { $setOnInsert: { ...entry } }, { upsert: true }],
    }, "findOneAndUpdate")));
    const failed = settled.filter((result) => result.status === "rejected");
    if (failed.length) {
        throw new Error(`${failed.length} of ${missing.length} project tab components were not stored: ${failed.map((result) => (result.reason && result.reason.message) || result.reason).join("; ")}`);
    }
    return missing.map((entry) => entry.keyName);
}

/* The catalogue has no unique index on keyName, so two concurrent heals of one company
 * could each insert the same view; this process runs one heal per company at a time. */
const healing = new Map();
function ensureViewCatalogue(companyId) {
    const key = String(companyId);
    if (!healing.has(key)) healing.set(key, addMissingViews(companyId).finally(() => healing.delete(key)));
    return healing.get(key);
}

module.exports = { VIEW_CATALOGUE, missingViews, findViews, addMissingViews, ensureViewCatalogue };
