const fs = require('fs');
const path = require('path');
var brandSettings = null; 
const { APIURL } = require('../../Config/config');
const { escapeHtml, textHtml, subjectText } = require('./emailText');
const filePath = path.join(__dirname, '../../brandSettings.json');

const sendEmailSecurityAlertMail = function(userName, ipAddress, brandName=''){
    if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        brandSettings = fileContent ? JSON.parse(fileContent) : null;
    }
    brandName = brandName == '' ? (`${brandSettings && brandSettings.productName ? brandSettings.productName : (`${process.env.APP_NAME ? process.env.APP_NAME : 'Alian Hub'}`)}`): brandName
    const imageUrl = APIURL + "api/v1/getlogo?key=logo&type=emailTemplateLogo" || 'https://firebasestorage.googleapis.com/v0/b/alianerphubdev.appspot.com/o/beta_logo.png?alt=media&token=7f601008-28eb-4fd9-a62a-3ef577fa4bd0';
    return {
  subject: subjectText(`${brandName} Security Alert: Too Many Authentication Attempts Detected`),
  mail: `<head>
        <meta charset="utf-8">
        <meta http-equiv="x-ua-compatible" content="ie=edge">
        <title>Aftom</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style type="text/css">
            @media screen {
                @font-face {
                    font-family: 'Source Sans Pro';
                    font-style: normal;
                    font-weight: 400;
                    src: local('Source Sans Pro Regular'), local('SourceSansPro-Regular'), url(https://fonts.gstatic.com/s/sourcesanspro/v10/ODelI1aHBYDBqgeIAH2zlBM0YzuT7MdOe03otPbuUS0.woff) format('woff');
                }

                @font-face {
                    font-family: 'Source Sans Pro';
                    font-style: normal;
                    font-weight: 700;
                    src: local('Source Sans Pro Bold'), local('SourceSansPro-Bold'), url(https://fonts.gstatic.com/s/sourcesanspro/v10/toadOcfmlt9b38dHJxOBGFkQc6VGVFSmCnC_l7QZG60.woff) format('woff');
                }
            }
            .parent-table {
                border-collapse:collapse;
                border-spacing: 0;
                border: 0;
                table-layout:fixed;
                min-width:100%;
                width:100%!important;
                color:#0a0836;
                font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Oxygen,Ubuntu,Cantarell,Fira Sans,Droid Sans,Helvetica Neue,sans-serif;
                font-size:14px;
                line-height:1.5;
                margin:0;
                padding:0;
                background-color: #f6fafb;
            }
            tr {
                padding:0
            }
            .logo {
                max-width:100%;
                outline:none;
                text-decoration:none;
                vertical-align:middle;
                border:none;
                height: 62px;
            }
        </style>
        </head>
        <body>
        <table class="parent-table" cellpadding="0" cellspacing="0">
            <tbody>
                <tr>
                    <td align="center" valign="top"
                        style="border-collapse:collapse!important;word-break:break-word;padding:10px 10px 0">
                        <a href="javascript:;" target="_blank">
                            <img alt="" title="" class="logo" src="${imageUrl}"/>
                        </a>
                    </td>
                </tr>
                <tr>
                    <td align="center" valign="top" style="border-collapse:collapse!important;word-break:break-word;min-width:100%;width:100%!important;margin:0;padding:20px 10px 30px">
                        <table border="0" cellpadding="0" cellspacing="0" width="580" style="border-collapse:collapse;border-spacing:0;table-layout:auto;border-radius:10px;padding:0" bgcolor="#fff">
                            <tbody>
                                <tr>
                                    <td align="left" valign="top" style="border-collapse:collapse!important;word-break:break-word;padding:30px 40px">
                                        <p>Dear ${textHtml(userName)},</p>
                                        <p>We noticed an unusual number of authentication attempts related to your account from the IP address <strong>${escapeHtml(ipAddress)}</strong>. For your security, we have temporarily restricted access to this IP.</p>
                                        <h3>What you can do:</h3>
                                        <ul>
                                            <li>If you need assistance or suspect unauthorized access, reach out to contact support.</li>
                                        </ul>
                                        <h3>Safety Tips:</h3>
                                        <ul>
                                            <li>Avoid sharing your login credentials with others.</li>
                                            <li>Ensure you are logging in through our official website or app.</li>
                                        </ul>
                                        <p>Your account security is our priority, and we are here to help if you have any concerns.</p>
                                        <p>Thank you for your understanding.</p>
                                        <p><strong>Best regards,</strong><br />${textHtml(brandName)} Security Team</p>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </td>
                </tr>
                <tr>
                    <td align="center" valign="top" style="border-collapse:collapse!important;word-break:break-word;padding:0 10px 10px">
                        <table border="0" cellpadding="0" cellspacing="0" width="580" style="border-collapse:collapse;border-spacing:0;table-layout:auto;padding:0">
                            <tbody>
                                <tr>
                                    <td align="center" style="border-collapse:collapse!important;word-break:break-word;color:#8d8c9f;font-size:11px;padding:0">
                                        <p style="font-size:14px;padding-bottom:10px;margin:0">Copyright ${new Date().getFullYear()} © ${textHtml(brandName)}, All Rights Reserved.</p>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </td>
                </tr>
            </tbody>
        </table>
        </body>`
}
}
module.exports = sendEmailSecurityAlertMail;