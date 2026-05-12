const ctrl = require('./controller');

exports.init = (app) => {
    /**
     * @swagger
    *  components:
    *    schemas:
    *      addMilestone:
    *        type: object
    *        required:
    *         - companyId
    *         - projectId
    *         - milestoneObject
    *         - ProjectName
    *         - userDetail
    *        properties:
    *         companyId: 
    *           type: string
    *           required: true
    *           description: companyId.
    *         projectId: 
    *           type: string
    *           required: true
    *           description: projectId.
    *         milestoneObject: 
    *           type: object
    *           required: true
    *           description: milestoneObject.
    *         ProjectName: 
    *           type: string
    *           required: true
    *           description: ProjectName.
    *         userDetail:
    *           type: object
    *           required: true
    *           description: userDetail.
    *         milestoneStatusObj:
    *           type: object
    *           required: false
    *           description: milestoneStatusObj.
    */
    /**
     * @swagger
     *  /api/v1/addmilestone:
     *    post: 
     *      description: This API is used for add milestone.
     *      tags: [Milestone APIs]
     *      summary: Add milestone API
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/addMilestone'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message
     */

    /**
     * add milestone API
    */
    app.post('/api/v1/addmilestone', ctrl.addMilestone);


    /**
     * @swagger
    *  components:
    *    schemas:
    *      updateMilestone:
    *        type: object
    *        required:
    *         - companyId
    *         - projectId
    *         - milestoneObject
    *         - ProjectName
    *         - userDetail
    *        properties:
    *         companyId: 
    *           type: string
    *           required: true
    *           description: companyId.
    *         projectId: 
    *           type: string
    *           required: true
    *           description: projectId.
    *         milestoneObject: 
    *           type: object
    *           required: true
    *           description: milestoneObject.
    *         ProjectName: 
    *           type: string
    *           required: true
    *           description: ProjectName.
    *         userDetail:
    *           type: object
    *           required: true
    *           description: userDetail.
    *         milestoneStatusObj:
    *           type: object
    *           required: false
    *           description: milestoneStatusObj.
    *         prevMilestoneName:
    *           type: string
    *           required: false
    *           description: prevMilestoneName.
    *         statusObj:
    *           type: object
    *           required: false
    *           description: statusObj.
    *         onlyNumber:
    *           type: number
    *           required: true
    *           description: onlyNumber.
    * 
    */
    /**
     * @swagger
     *  /api/v1/updatemilestone:
     *    post: 
     *      description: This API is used for update milestone.
     *      tags: [Milestone APIs]
     *      summary: Update milestone API
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/updateMilestone'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message
     */

    /**
     * update milestone API
    */
    app.post('/api/v1/updatemilestone', ctrl.updateMilestone);
    
    
    /**
     * @swagger
    *  components:
    *    schemas:
    *      deleteMilestone:
    *        type: object
    *        required:
    *         - companyId
    *         - projectId
    *         - milestoneObjForDelete
    *         - ProjectName
    *         - userDetail
    *        properties:
    *         companyId: 
    *           type: string
    *           required: true
    *           description: companyId.
    *         projectId: 
    *           type: string
    *           required: true
    *           description: projectId.
    *         milestoneObjForDelete: 
    *           type: object
    *           required: true
    *           description: milestoneObjForDelete.
    *         ProjectName: 
    *           type: string
    *           required: true
    *           description: ProjectName.
    *         userDetail:
    *           type: object
    *           required: true
    *           description: userDetail.
    *         onlyNumber:
    *           type: number
    *           required: true
    *           description: onlyNumber.
    */
    /**
     * @swagger
     *  /api/v1/deletemilestone:
     *    post: 
     *      description: This API is used for delete milestone.
     *      tags: [Milestone APIs]
     *      summary: Delete milestone API
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/deleteMilestone'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message
     */

    /**
     * delete milestone API
    */
    app.post('/api/v1/deletemilestone', ctrl.deleteMilestone);
    
    
    /**
     * @swagger
    *  components:
    *    schemas:
    *      clearMilestoneStatus:
    *        type: object
    *        required:
    *         - companyId
    *         - projectId
    *         - milestoneObject
    *         - ProjectName
    *         - userDetail
    *        properties:
    *         companyId: 
    *           type: string
    *           required: true
    *           description: companyId.
    *         projectId: 
    *           type: string
    *           required: true
    *           description: projectId.
    *         milestoneObject: 
    *           type: object
    *           required: true
    *           description: milestoneObject.
    *         ProjectName: 
    *           type: string
    *           required: true
    *           description: ProjectName.
    *         userDetail:
    *           type: object
    *           required: true
    *           description: userDetail.
    */
    /**
     * @swagger
     *  /api/v1/clearmilestonestatus:
     *    post: 
     *      description: This API is used for clear milestonestatus.
     *      tags: [Milestone APIs]
     *      summary: clearmilestone status API
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/clearMilestoneStatus'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message
     */

    /**
     * clear milestone API
    */
    app.post('/api/v1/clearmilestonestatus', ctrl.clearMilestoneStatus);
    
    
    /**
     * @swagger
    *  components:
    *    schemas:
    *      cancelMilestoneStatus:
    *        type: object
    *        required:
    *         - companyId
    *         - projectId
    *         - milestoneObject
    *         - ProjectName
    *         - userDetail
    *        properties:
    *         companyId: 
    *           type: string
    *           required: true
    *           description: companyId.
    *         projectId: 
    *           type: string
    *           required: true
    *           description: projectId.
    *         milestoneObject: 
    *           type: object
    *           required: true
    *           description: milestoneObject.
    *         ProjectName: 
    *           type: string
    *           required: true
    *           description: ProjectName.
    *         userDetail:
    *           type: object
    *           required: true
    *           description: userDetail.
    *         statusObj:
    *           type: object
    *           required: false
    *           description: statusObj.
    *         onlyNumber:
    *           type: number
    *           required: false
    *           description: onlyNumber.
    */
    /**
     * @swagger
     *  /api/v1/cancelmilestonestatus:
     *    post: 
     *      description: This API is used for cancel milestonestatus.
     *      tags: [Milestone APIs]
     *      summary: cancel milestone status API
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/cancelMilestoneStatus'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message
     */

    /**
     * cancel milestone status API
    */
    app.post('/api/v1/cancelmilestonestatus', ctrl.cancelMilestoneStatus);
    
    
    /**
     * @swagger
    *  components:
    *    schemas:
    *      refundAmount:
    *        type: object
    *        required:
    *         - companyId
    *         - projectId
    *         - milestoneObject
    *        properties:
    *         companyId: 
    *           type: string
    *           required: true
    *           description: companyId.
    *         projectId: 
    *           type: string
    *           required: true
    *           description: projectId.
    *         milestoneObject: 
    *           type: object
    *           required: true
    *           description: milestoneObject.
    *         onlyNumber: 
    *           type: number
    *           required: true
    *           description: onlyNumber.
    */
    /**
     * @swagger
     *  /api/v1/refundamount:
     *    post: 
     *      description: This API is used for refundAmount.
     *      tags: [Milestone APIs]
     *      summary: refundAmount API
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/refundAmount'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message
     */

    /**
     * refundAmount API
    */
    app.post('/api/v1/refundamount', ctrl.refundAmount);
    
    
    /**
     * @swagger
    *  components:
    *    schemas:
    *      draggableMilestone:
    *        type: object
    *        required:
    *         - companyId
    *         - projectId
    *         - milestoneObject
    *        properties:
    *         companyId: 
    *           type: string
    *           required: true
    *           description: companyId.
    *         projectId: 
    *           type: string
    *           required: true
    *           description: projectId.
    *         milestoneObject: 
    *           type: object
    *           required: true
    *           description: milestoneObject.
    */
    /**
     * @swagger
     *  /api/v1/draggablemilestone:
     *    post: 
     *      description: This API is used for draggableMilestone.
     *      tags: [Milestone APIs]
     *      summary: draggableMilestone API
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/draggableMilestone'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message
     */

    /**
     * draggableMilestone API
    */
    app.post('/api/v1/draggablemilestone', ctrl.draggableMilestone);

    app.get('/api/v1/milestone/project/:pid', ctrl.getMilestoneByProject);
    app.get('/api/v1/milestone/:id', ctrl.getMilestone);
    app.post('/api/v1/milestone', ctrl.updateWeeklyRangeMilestone);
    app.post('/api/v1/milestoneReport', ctrl.getMilestoneReport);
};