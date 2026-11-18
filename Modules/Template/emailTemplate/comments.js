const roundImage = require("./roundImage")
const commonTemplate = require("./commonTemplate")
const {Notification_key,TemplateType} = require("../../../Config/notificationKey");
exports.createView = ({ data = [], key = '' }) => {
    return `<div style="margin:0 auto">
        ${manageRender(key, data)}
    </div>`
}
function manageRender(type, data) {
    switch (type) {
        case TemplateType.COMMENTS:
            return createData(data)

        default:
            return `<div></div>`
    }
}

function createData(data) {
    return (
        `<div>
            ${data.length > 0 ? data.map(item => {
            return (
                `
                <table class="px" width="100%" align="center" role="presentation" border="0" cellpadding="0" cellspacing="0" style="mso-table-lspace:0pt;mso-table-rspace:0pt;padding:0px 0px;table-layout: fixed;">
                <tbody>
                <tr>
                  <td class="column col-sm-12" width="640" style="mso-table-lspace:0pt;mso-table-rspace:0pt;padding: 20px 10px 20px 20px;width: 9%; text-align: left;" align="left" valign="top">
                      ${commonTemplate.imageViewTD(item.profile)}
                  </td>
                  <td class="column col-sm-12" width="640" style="mso-table-lspace:0pt;mso-table-rspace:0pt;padding:20px 0px 20px 10px;width: 31%; text-align: left;" align="left" valign="middle">
                      ${commonTemplate.userNameViewTD(item.name)}
                  </td>
                  <td class="column col-sm-12" width="640" style="mso-table-lspace:0pt;mso-table-rspace:0pt;padding:20px 20px 20px 00px;width:60%; text-align: left;" align="left" valign="middle">
                       ${commonTemplate.dateViewTD(item.date)}
                  </td>
                </tr>
                <tr>
                  <td colspan="3" class="column col-sm-12" width="640" style="mso-table-lspace:0pt;mso-table-rspace:0pt;padding: 0px 10px 20px 20px;width: 100%; text-align: left;" align="left" valign="top">
                  <table class="px" role="presentation" border="0" align="center" cellpadding="20" cellspacing="0" width="100%" style="mso-table-lspace:0pt;mso-table-rspace:0pt; padding: 0 60px;">
                      <tbody>
                        <tr>
                          <td width="100%" align="left" valign="top" style="mso-table-lspace:0pt;mso-table-rspace:0pt; padding: 0px;">
                            <div>
                              <table width="100%" align="center" role="presentation" border="0" cellpadding="0" cellspacing="0" style="mso-table-lspace:0pt;mso-table-rspace:0pt;table-layout: fixed;">
                                  <tbody>
                                    <tr style="display:flex;align-items: center;">
                                      <td style="mso-table-lspace:0pt;mso-table-rspace:0pt; padding-left: 0; padding-right: 20px; width: 100%; min-width:0px;" align="left" valign="top">
                                         ${commonTemplate.messageTextOnly(item.message)}
                                      </td>
                                    </tr>
                                </tbody>
                              </table>
                            </div>
                          </td>
                      </tr>
                    </tbody>
                  </table>
                  </td>
                </tr>
                </tbody>
                </table>
              
                
                `
            )
        }).join("")
            : `<div></div>`
        }
        </div>`
    )

}
