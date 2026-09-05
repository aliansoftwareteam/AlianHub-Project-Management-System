const ctrl = require('./controller');

exports.init = (app) => {
    /**
     * @swagger
     * /api/v1/ai/project/upload-brief:
     *   post:
     *     summary: Upload a project brief (PDF / DOCX / TXT / MD) for the AI generator
     *     tags: [AI Project Generator]
     *     responses:
     *       200: { description: returns briefId + extracted text stats }
     */
    app.post('/api/v1/ai/project/upload-brief', ...ctrl.uploadBrief);

    /**
     * @swagger
     * /api/v1/ai/project/plan:
     *   post:
     *     summary: Start async project-plan generation from a description
     *     tags: [AI Project Generator]
     *     description: |
     *       Returns a jobId immediately. The generated plan is delivered on
     *       /api/v1/ai-progress/{jobId}, avoiding proxy 504s while the LLM is
     *       still producing the full plan.
     */
    app.post('/api/v1/ai/project/plan', ctrl.plan);

    /**
     * @swagger
     * /api/v1/ai/project/clarify:
     *   post:
     *     summary: Generate clarifying questions for the wizard's Clarify step
     *     tags: [AI Project Generator]
     *     description: |
     *       Reads the brief (description + additional requirements + uploaded
     *       brief text) and returns a small structured list of clarifying
     *       questions the user is asked BEFORE plan generation. The answers
     *       come back on /plan as a `clarifications` field. Synchronous —
     *       the request returns the questions inline (no SSE, no jobId).
     *       Returning `{ status: true, questions: [] }` is valid: it tells
     *       the frontend the brief is already complete enough to skip Q&A.
     */
    app.post('/api/v1/ai/project/clarify', ctrl.clarify);

    /**
     * @swagger
     * /api/v1/ai/project/brief:
     *   post:
     *     summary: Draft the brief (five sections + assumptions) the user approves before planning
     *     tags: [AI Project Generator]
     *     description: |
     *       Rewrites description + uploaded brief + clarify answers into the
     *       five headed sections, with one assumption per skipped or unknown
     *       answer and per point still missing. Returns `brief.markdown`,
     *       which the user edits and approves and /plan receives as
     *       `approvedBrief`. Synchronous.
     */
    app.post('/api/v1/ai/project/brief', ctrl.brief);

    /**
     * @swagger
     * /api/v1/ai/project/execute:
     *   post:
     *     summary: Execute an approved plan and create the full project bootstrap
     *     tags: [AI Project Generator]
     */
    app.post('/api/v1/ai/project/execute', ctrl.execute);

    /**
     * @swagger
     * /api/v1/ai/project/{projectId}/tasks/plan:
     *   post:
     *     summary: Start async AI task-plan generation for an EXISTING project (AHE-3777)
     *     tags: [AI Project Generator]
     *     description: |
     *       Generates sprints + tasks for the given existing project from the
     *       team's requirements. Returns a jobId immediately; the plan is
     *       delivered on /api/v1/ai-progress/{jobId}. Does NOT create a project.
     */
    app.post('/api/v1/ai/project/:projectId/tasks/plan', ctrl.tasksPlan);

    /**
     * @swagger
     * /api/v1/ai/project/{projectId}/tasks/execute:
     *   post:
     *     summary: Persist an approved AI task plan into an EXISTING project (AHE-3777)
     *     tags: [AI Project Generator]
     */
    app.post('/api/v1/ai/project/:projectId/tasks/execute', ctrl.tasksExecute);

    /**
     * @swagger
     * /api/v1/ai-progress/{jobId}:
     *   get:
     *     summary: SSE stream of progress events for an executing plan
     *     tags: [AI Project Generator]
     *     description: Unauthenticated by design — EventSource can't send auth
     *       headers. The jobId is a random 24-char hex (≥96 bits of entropy)
     *       so it acts as a bearer-style capability. Path is intentionally
     *       outside `/api/v1/ai/project/execute` so Express prefix-matching
     *       on the auth middleware does NOT pick it up.
     */
    app.get('/api/v1/ai-progress/:jobId', ctrl.events);
};
