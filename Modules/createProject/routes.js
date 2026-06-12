const ctrl = require('./controller');
const { requirePermission } = require('../../Config/permissionGuard');

exports.init = (app) => {
    /**
     * @swagger
    *  components:
    *    schemas:
    *      createProject:
    *        type: object
    *        required:
    *         - projectIcon
    *         - ProjectCategory
    *         - ProjectName
    *         - ProjectCode
    *         - CompanyId
    *        properties:
    *         CompanyId: 
    *           type: string
    *           required: true
    *           description: CompanyId.
    *         ProjectCategory: 
    *           type: string
    *           required: true
    *           description: ProjectCategory.
    *         projectIcon: 
    *           type: object
    *           required: true
    *           description: projectIcon.
    *         ProjectCode: 
    *           type: string
    *           required: true
    *           description: ProjectCode.
    *         ProjectName:
    *           type: string
    *           required: true
    *           description: ProjectName.
    */
    /**
     * @swagger
     *  /api/v1/createProject:
     *    post: 
     *      description: This API is used for create project.
     *      tags: [Create Project APIs]
     *      summary: create Project API
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/createProject'
     *      responses:
     *          "200":
     *              description: status:true/false,statusText:message
     */

    /**
     * create Project API
    */
    app.post('/api/v1/createproject', requirePermission('project.project_create'), ctrl.createProjectFun);
    app.post('/api/v1/getGlobalTemplate', ctrl.getGlobalTemplate);
}