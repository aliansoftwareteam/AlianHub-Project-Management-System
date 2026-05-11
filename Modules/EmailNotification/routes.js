const {SendEmail} = require("../service");
const logger = require("../../Config/loggerConfig")
exports.init = (app) => {
    app.post("/api/v2/sendMail", (req, res) => {
        try {
            const {subject, html, toMail, isHtml} = req.body;
            SendEmail(subject, html, toMail, isHtml, (result) => {
                if(result.status) {
                    res.send({
                        status: true,
                        statusText: "Email sent successfully."
                    });
                } else {
                    console.error(result.error);
                    logger.error(`Error Try Catch ${result.error}`);
                    res.send({
                        status: false,
                        statusText: result.error
                    });
                }
            })
        } catch (error) {
            res.status(400).send({status: false, statusText: error?.message})
        }
    })
};