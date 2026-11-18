const fs = require("fs");

exports.updateEmailTemplate = (req,res) => {
    try {
        if(!req.body.emailData || req.body.emailData === '') {
            res.send({
                status: false,
                statusText: "Email Data is required."
            });
            return;
        }
        if(!req.body.id || req.body.id === '') {
            res.send({
                status: false,
                statusText: "Id is required."
            });
            return;
        }

        const filePath = req.body.id === 1 ? __dirname + '/../Template/sendEmailVerification.js' : req.body.id === 2 ? __dirname + '/../Template/forgotPassword.js' : __dirname + '/../Template/sendEmailInvitation.js';
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                console.error('Error reading file:', err);
                return;
            }
            const newReturnStatement = `return {\n  subject: \`${req.body.subject}\`,\n  mail: \`${req.body.emailData}\`\n}`;
            const updatedData = data.replace(/return\s*\{[\s\S]*?mail:\s*`[\s\S]*?`\s*\}/, newReturnStatement);

            // Write the updated content back to the file
            fs.writeFile(filePath, updatedData, 'utf8', (err) => {
                if (err) {
                    console.error('Error writing file:', err);
                    res.send({status: false, statusText : err})
                    return;
                }
                res.send({status: true, statusText : 'done'})
            });
        });
    } catch (error) {
        console.error(error,"errorerror");
        res.send({status: false, statusText : error})
    }
}