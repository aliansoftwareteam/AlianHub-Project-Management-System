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
        try {
            const {companyId = "", projectId = "", sprintId = "", searchKey} = req.body;
            if(!companyId) {
                return res.status(404).send("companyId is required")
            } else if(!projectId && !searchKey) {
                return res.status(404).send("projectId is required")
            } else if (String(companyId) !== String(req.headers.companyid)) {
                return res.status(403).send("companyId does not match your session")
            }

            ctrl.unsetAllCounts(companyId, projectId, sprintId, {searchKey})
            .then((result) => {
                res.send(result.statusText)
            })
            .catch((error) => {
                res.status(404).send(error)
            })
        } catch (error) {
            res.status(404).send(error)
        }
    });
}