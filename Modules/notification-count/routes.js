const ctrl = require('./controller');
exports.init = (app) => {
      /**
     * @swagger
    *  components:
    *    schemas:
    *      updateunreadcommentscount:
    *        type: object
    *        required:
    *         - read
    *         - key
    *         - companyId
    *        properties:
    *         read: 
    *           type: boolean
    *           required: true
    *           description: True if it is read or false.
    *         key: 
    *           type: Number
    *           required: true
    *           description: Key based on opration.
    *         companyId: 
    *           type: string
    *           required: true
    *           description: Id of comapny.
    *         projectId: 
    *           type: string
    *           required: false
    *           description: Id of project if key is 1 or 2.
    *         userIds:
    *           type: array
    *           items:
    *             type: string
    *           description: UserId's array in which opration is need to perform.
    *         sprintId: 
    *           type: string
    *           required: false
    *           description: Id of sprint if key is 2.
    *         taskId: 
    *           type: string
    *           required: false
    *           description: Id of task if key is 2.
    *         messageId: 
    *           type: string
    *           required: false
    *           description: Id of message user or chanel if key is 3.
    *         prevCount: 
    *           type: number
    *           required: false
    *           description: number of previous message count (if not provided then default to 0).
    *         parentTaskId: 
    *           type: string
    *           required: false
    *           description: Id of parent task if message is sent from child task.
    *         readAll: 
    *           type: boolean
    *           required: false
    *           description: True if all mention notification is read if key is 4.
 
     */
    /**
     * @swagger
     *  /api/v1/updateunreadcommentscount:
     *    post: 
     *      description: This API is used for Update Notification count in mongodb.
     *      tags: [Notification Count APIs]
     *      summary: Notification count Update.
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/updateunreadcommentscount'
     *      responses:
     *          "200":
     *              description: status:true/false, statusText:message
     */
    app.post("/api/v1/updateunreadcommentscount", ctrl.updateUnReadCommentsCount);
    app.post("/api/v1/pushupdateunreadcommentscount", ctrl.updateUnReadCommentsCount);

    app.post("/api/v1/unsetCommentCounts", (req, res) => {
        const sessionCompanyId = String(req.headers.companyid || "");
        const { companyId: bodyCompanyId, projectId = "", sprintId = "", searchKey } = req.body || {};
        if (bodyCompanyId && String(bodyCompanyId) !== sessionCompanyId) {
            return res.status(403).send({ status: false, statusText: "companyId does not match your session" });
        }
        if (!projectId && !searchKey) {
            return res.status(400).send({ status: false, statusText: "projectId or searchKey is required" });
        }
        return ctrl.unsetAllCounts(sessionCompanyId, projectId, sprintId, { searchKey })
            .then((result) => {
                res.send({ status: true, statusText: result.statusText, data: result.data });
            })
            .catch((error) => {
                const statusText = (error && (error.statusText || error.message)) || String(error);
                res.status(500).send({ status: false, statusText });
            });
    });
}