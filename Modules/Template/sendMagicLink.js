const fs = require('fs');
const path = require('path');
const { APIURL } = require('../../Config/config');
const filePath = path.join(__dirname, '../../brandSettings.json');

module.exports = function (link, minutes = 15) {
    let brandSettings = null;
    if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        brandSettings = fileContent ? JSON.parse(fileContent) : null;
    }
    const brandName = (brandSettings && brandSettings.productName) || process.env.APP_NAME || 'Alian Hub';
    const logo = `${APIURL}api/v1/getlogo?key=logo&type=emailTemplateLogo`;
    return {
        subject: `${brandName}: your login link`,
        mail: `<!doctype html><html><body style="margin:0;background:#f7f6f3;font-family:'Inter Tight',Inter,Segoe UI,Arial,sans-serif;color:#17161c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="440" cellpadding="0" cellspacing="0" style="max-width:440px;background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:12px">
<tr><td style="padding:24px 28px 8px"><img src="${logo}" alt="${brandName}" height="28" style="height:28px"></td></tr>
<tr><td style="padding:8px 28px 0;font-size:22px;font-weight:600;letter-spacing:-.4px">Log in to ${brandName}</td></tr>
<tr><td style="padding:10px 28px 0;font-size:14px;line-height:1.5;color:rgba(0,0,0,.65)">Click the button below to log in. The link works once and expires in ${minutes} minutes. If you didn't ask for it, you can ignore this email.</td></tr>
<tr><td style="padding:22px 28px 0"><a href="${link}" style="display:inline-block;background:#2F3990;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:8px">Log in</a></td></tr>
<tr><td style="padding:18px 28px 26px;font-size:12px;line-height:1.5;color:rgba(0,0,0,.45);word-break:break-all">Or paste this into your browser:<br>${link}</td></tr>
</table></td></tr></table></body></html>`
    };
};
