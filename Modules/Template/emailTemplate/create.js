const roundImage = require("./roundImage")
const commonTemplate = require("./commonTemplate")
const {Notification_key,TemplateType,ChangeTypes} = require("../../../Config/notificationKey");
exports.createView = ({ data = [], key = '' }) => {
    return `<div style="margin:0 auto;">
        ${manageRender(key, data)}
      </div>`
}
function manageRender(type, data) {
    switch (type) {
        case TemplateType.CREATE:
            return createData(data)

        default:
            return `<div></div>`
    }
}

function createData(data) {
    let item = data[0];
    return (
        `<div>
            ${data.length > 0 ?
                `
               <table class="px" width="100%" align="center" role="presentation" border="0" cellpadding="0" cellspacing="0" style="mso-table-lspace:0pt;mso-table-rspace:0pt;padding:0px 0px 0px 0px;table-layout: fixed;">
                <tbody>
                  <tr>
                    <td>
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
                                    ${manageSubRender(item?.changeType, item?.changeData)}
                                    </div>
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
                </tbody>
              </table>
                `
            : `<div></div>`
        }
        </div>`
    )

}

function checkFolderAndSprint(item) {
  //${manageSubRender(item?.changeType, item?.changeData)}
         // ${commonTemplate.LabelAndValueTextOnly(item.taskLabel, item.taskValue)}
                                    // ${checkFolderAndSprint(item)}
    if ("folder" in item) {
            return (`
            <div>
                ${commonTemplate.LabelAndValueTextOnly("Folder", item.folder)}
                ${commonTemplate.LabelAndValueTextOnly("List", item.list)}
            </div>
            `)
        }
        else if ("list" in item) {
           return commonTemplate.LabelAndValueTextOnly("List", item.list)
            }
    }

function manageSubRender(type, data) {
  switch (type) {
      case ChangeTypes.PROJECT_CREATE:
          return projectCreateRender(data)
      case ChangeTypes.SPRINT_CREATE:
          return sprintCreateRender(data)
      case ChangeTypes.FOLDER_CREATE:
          return folderCreateRender(data)
      default:
          return commonTemplaterender(data)
  }
}

function projectCreateRender(data){
  return commonTemplate.LabelAndValueTextOnly("",`${data.ProjectName} Project Created.`)
}

function sprintCreateRender(data) {
  return commonTemplate.LabelAndValueTextOnly("",`${data.sprintName} Sprint Created in ${data.ProjectName}.`)
}

function folderCreateRender(data) {
  return commonTemplate.LabelAndValueTextOnly("",`${data.sprintFolderName} Folder Created in ${data.ProjectName}.`)
}

function commonTemplaterender(data) {
  return commonTemplate.LabelAndValueTextOnly("",`${data}`)

}
