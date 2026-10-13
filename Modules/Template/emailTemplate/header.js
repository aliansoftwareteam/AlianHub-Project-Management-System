const { USERPROFILEBUCKET } = require('../../../Config/config');
const awsRef = require('../../../Config/aws.js');
const { textHtml } = require('../emailText');
exports.headerHTML = ({ title = "", description = [] }) => {
    return(
        `
    <table width="100%" align="center" role="presentation" border="0" cellpadding="0" cellspacing="0" style="mso-table-lspace:0pt;mso-table-rspace:0pt;table-layout: fixed;">
        <tbody>
        <tr>
          <td class="column col-sm-12" width="640" style="mso-table-lspace:0pt;mso-table-rspace:0pt;padding-top: 0px; padding-bottom: 10px;width: 100%; text-align: center;" align="center" valign="top">
            <a href="#" target="_blank" style="text-size-adjust:100%;-ms-text-size-adjust:100%;-moz-text-size-adjust:100%;-webkit-text-size-adjust:100%;text-decoration:none;text-decoration: none; margin: 0; color: #253D98;">
              <span style="font-size:30px;font-weight: 600; line-height: 39px;  text-size-adjust:100%;-ms-text-size-adjust:100%;-moz-text-size-adjust:100%;-webkit-text-size-adjust:100%;margin: 0; text-decoration: none; color: #253D98;">
                <!-- ===== LOGO ===== -->
                ${textHtml(title)}
                <!-- ===== LOGO ===== -->
              </span>
            </a>
          </td>
        </tr>
      </tbody>
    </table>
    <table width="100%" align="center" role="presentation" border="0" cellpadding="0" cellspacing="0" style="mso-table-lspace:0pt;mso-table-rspace:0pt;table-layout: fixed;">
        <tbody>
          <tr>
            <td class="column col-sm-12" width="640" style="mso-table-lspace:0pt;mso-table-rspace:0pt;padding-top: 0px;padding-left: 60px;padding-right: 60px; padding-bottom: 0px;width: 100%; text-align: center;" align="center" valign="top">
              ${headerDescriptions(description)}
            </td>
          </tr>
      </tbody>
    </table>
 `
    )

}

function headerDescriptions(description) {
    return `
    ${description.length > 0 ? description.map((item, index) => {
        return (
            `
            ${index!=0?`<span style="padding:0px 5px;"> /</span>`:`<span/>`}
            ${item.showFolder? `<img src="https://s3.${awsRef.region}.wasabisys.com/${USERPROFILEBUCKET}/public_assets/email_folder_icon.png" alt="folder-icon" style="padding:0px 5px;">`:`<span/>`}
            <a href="#" target="_blank" style="font-size:16px;line-height:30px;color:#818181;text-size-adjust:100%;-ms-text-size-adjust:100%;-moz-text-size-adjust:100%;-webkit-text-size-adjust:100%;text-decoration:none;text-decoration: none; margin: 0;">
            ${textHtml(item.title)}
            </a>
         `
        )
    }).join("") : `<div></div>`}
</div>`

}
exports.subHeader = ({ title = "" }) => {
    return(
      `
      <p class="sub-p" style="text-size-adjust:100%;-ms-text-size-adjust:100%;-moz-text-size-adjust:100%;-webkit-text-size-adjust:100%;font-size:20px;line-height:26px;color: #253D98; margin: 0 !important;">
      <font color="#253D98">${textHtml(title)} </font>
    </p>
    `
    )
}