const fs = require('fs');
const path = require('path');
var brandSettings = null; 
const { APIURL } = require('../../Config/config');
const { escapeHtml, textHtml, subjectText } = require('./emailText');
const filePath = path.join(__dirname, '../../brandSettings.json');

const sendEmailPasswordExpiredMail = function(email, link, brandName=''){
    if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        brandSettings = fileContent ? JSON.parse(fileContent) : null;
    }
    brandName = brandName == '' ? (`${brandSettings && brandSettings.productName ? brandSettings.productName : (`${process.env.APP_NAME ? process.env.APP_NAME : 'Alian Hub'}`)}`): brandName
    const imageUrl = APIURL + "api/v1/getlogo?key=logo&type=emailTemplateLogo" || 'https://firebasestorage.googleapis.com/v0/b/alianerphubdev.appspot.com/o/beta_logo.png?alt=media&token=7f601008-28eb-4fd9-a62a-3ef577fa4bd0';
    return {
  subject: subjectText(`Set New Password | ${brandName}`),
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
                                        <p>Your password has expired, and your account requires a new password to continue. </p>
                                        <p> Please set your new password by clicking the button below: </p>
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border-spacing:0;table-layout:auto;padding:0">
                                            <tbody>
                                                <tr>
                                                    <td align="center" valign="middle" style="border-collapse:collapse!important;word-break:break-word;padding:30px 0 30px">
                                                        <a href="${escapeHtml(link)}"
                                                            style="cursor:pointer; border-radius: 10px;padding: 10px 20px 10px;color:#fff!important;display:block;font-size:15px;font-weight:700;text-decoration:none;background-color:#253d98;"
                                                            tagret="_blank">
                                                            Click here to set new password
                                                        </a>
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
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
module.exports = sendEmailPasswordExpiredMail;