const ctrl = require('./controller');
const sessionCtr = require('./session');

exports.init = (app) => {

    app.post('/api/v1/removeUserNotification',  ctrl.removeUserNotification);


    /**
     * @swagger
     *  components:
     *    schemas:
     *      registerAuth:
     *        type: object
     *        required:
     *          - email
     *          - password
     *        properties:
     *         email:
     *           type: string
     *           required: true
     *           description: The email of user.
     *         password:
     *           type: string
     *           required: true
     *           description: The password of user.
     */
    /**
     * @swagger
     *  /api/v2/auth/register:
     *    post: 
     *      description: This API is used for register auth.
     *      tags: [Auth APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/registerAuth'
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.post("/api/v2/auth/register", ctrl.registerAuth);


    /**
     * @swagger
     *  components:
     *    schemas:
     *      loginAuth:
     *        type: object
     *        required:
     *          - email
     *          - password
     *        properties:
     *         email:
     *           type: string
     *           required: true
     *           description: The email of user.
     *         password:
     *           type: string
     *           required: true
     *           description: The password of user.
     */
    /**
     * @swagger
     *  /api/v2/auth/login:
     *    post: 
     *      description: This API is used for login auth.
     *      tags: [Auth APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/loginAuth'
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.post("/api/v2/auth/login", ctrl.loginAuth, ctrl.manageAttempt)
    app.post("/api/v1/auth/loginAuthTracker", ctrl.loginAuthTracker)

    // Two-factor auth (TOTP) — Phase 1, password login only.
    // setup/verify/disable require a logged-in session (gated by
    // verifyJWTTokenWithCV2 via Config/setMiddleware.js); validate is public
    // and exchanges a tempToken + code for a real session, rate-limited like
    // login via manageAttempt.
    app.get("/api/v2/auth/2fa/status", ctrl.twoFaStatus)
    app.post("/api/v2/auth/2fa/setup", ctrl.twoFaSetup)
    app.post("/api/v2/auth/2fa/verify", ctrl.twoFaVerify)
    app.post("/api/v2/auth/2fa/disable", ctrl.twoFaDisable)
    app.post("/api/v2/auth/2fa/validate", ctrl.twoFaValidate, ctrl.manageAttempt)

    // Passwordless login link (public, pre-auth). Enable/disable with MAGIC_LINK_ENABLED.
    app.post("/api/v2/auth/magic-link", ctrl.requestMagicLink)
    app.get("/api/v2/auth/magic-link/verify", ctrl.verifyMagicLink)


    /**
     * @swagger
     *  components:
     *    schemas:
     *      changePasswordAuth:
     *        type: object
     *        required:
     *          - oldPassword
     *          - newPassword
     *        properties:
     *         oldPassword:
     *           type: string
     *           required: true
     *           description: The old password of user.
     *         newPassword:
     *           type: string
     *           required: true
     *           description: The new password of user.
     */
    /**
     * @swagger
     *  /api/v2/auth/{id}/change-password:
     *    patch: 
     *      description: This API is used for login auth.
     *      tags: [Auth APIs]
     *      parameters:
     *        - in: path
     *          name: id
     *          required: true
     *          schema:
     *          type: string
     *          description: The user id
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/changePasswordAuth'
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.patch("/api/v2/auth/:id/change-password", ctrl.changePassword);


    /**
     * @swagger
     *  components:
     *    schemas:
     *      forgotPasswordAuth:
     *        type: object
     *        required:
     *          - email
     *        properties:
     *         email:
     *           type: string
     *           required: true
     *           description: The email of user.
     */
    /**
     * @swagger
     *  /api/v2/auth/forgot-password:
     *    post: 
     *      description: This API is used for send forgot password mail.
     *      tags: [Auth APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/forgotPasswordAuth'
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.post('/api/v2/auth/forgot-password', ctrl.forgotPassword, ctrl.manageAttempt);


    /**
     * @swagger
     *  components:
     *    schemas:
     *      tokenVerifyforgotPasswordAuth:
     *        type: object
     *        required:
     *          - token
     *        properties:
     *         token:
     *           type: string
     *           required: true
     *           description: The token.
     */
    /**
     * @swagger
     *  /api/v2/auth/token-verify-forgotpassword:
     *    post: 
     *      description: This API is used for verify forgot request.
     *      tags: [Auth APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/tokenVerifyforgotPasswordAuth'
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.post('/api/v2/auth/token-verify-forgotpassword', ctrl.tokenVerfiyForgotPassword);


    /**
     * @swagger
     *  components:
     *    schemas:
     *      resetPasswordAuth:
     *        type: object
     *        required:
     *          - token
     *          - id
     *          - password
     *        properties:
     *         token:
     *           type: string
     *           required: true
     *           description: The token.
     *         id:
     *           type: string
     *           required: true
     *           description: The User id.
     *         password:
     *           type: string
     *           required: true
     *           description: The user new password.
     */
    /**
     * @swagger
     *  /api/v2/auth/reset-password:
     *    post: 
     *      description: This API is used for verify forgot request.
     *      tags: [Auth APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/resetPasswordAuth'
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.post('/api/v2/auth/reset-password', ctrl.resetPassword, ctrl.manageAttempt);


    /**
     * @swagger
     *  components:
     *    schemas:
     *      registerSession:
     *        type: object
     *        required:
     *          - userId
     *        properties:
     *         userId:
     *           type: string
     *           required: true
     *           description: The User Id.
     */
    /**
     * @swagger
     *  /api/v2/session/register:
     *    post: 
     *      description: This API is used for register a session.
     *      tags: [Session APIs]
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/registerSession'
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.post('/api/v2/session/register', sessionCtr.registerSesstion);


    /**
     * @swagger
     *  /api/v2/session/delete:
     *    delete: 
     *      description: This API is used for delete all session and session caches.
     *      tags: [Session APIs]
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.delete('/api/v2/session/delete', sessionCtr.deleteAllSession);


    /**
     * @swagger
     *  /api/v2/session/delete/{id}:
     *    delete: 
     *      description: This API is used for delete user specific session and session caches.
     *      tags: [Session APIs]
     *      parameters:
     *        - in: path
     *          name: id
     *          required: true
     *          schema:
     *          type: string
     *          description: The user id
     *      responses:
     *          "200":
     *              description: status:true, message:message
     */
    app.delete('/api/v2/session/delete/:id', sessionCtr.deleteUserSpecificSession);
    app.put('/api/v2/session/update', sessionCtr.updateSession);


    /**
     * @swagger
     *  components:
     *    schemas:
     *      generateTokenSchema:
     *        type: object
     *        required:
     *          - uid
     *        properties:
     *         uid:
     *           type: string
     *           required: true
     *           description: The User Id.
     */
    /**
     * @swagger
     *  /api/v2/generateToken:
     *    post: 
     *      description: This API is used for generate a new access token.
     *      tags: [Auth APIs]
     *      parameters:
     *        - in: header
     *          name: refresh-token
     *          required: true
     *          schema:
     *            type: string
     *          description: token for refresh-token.
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/generateTokenSchema'
     *      responses:
     *          "200":
     *              description: status:true, token:token
     */
    app.post("/api/v2/generateToken", ctrl.generateTokenV2);
    app.post("/api/v2/logout", ctrl.logout);
    app.post("/api/v2/test", ctrl.testV2);
};
