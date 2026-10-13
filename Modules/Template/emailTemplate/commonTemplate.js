const roundImage = require("./roundImage")
const { APIURL, USERPROFILEBUCKET } = require('../../../Config/config');
const awsRef = require('../../../Config/aws.js');
const { textHtml, commentHtml, messageHtml, cssColor, imageSrc } = require('../emailText');
const imageUrl = APIURL + "api/v1/getlogo?key=logo&type=emailTemplateLogo" || 'https://firebasestorage.googleapis.com/v0/b/alianerphubdev.appspot.com/o/beta_logo.png?alt=media&token=7f601008-28eb-4fd9-a62a-3ef577fa4bd0';
exports.titleAndValueWithText = (key = "", value = "") => {
    return (
        `<div style="padding-left: 15px;">
            <span style="color: #818181;
                        font-family: Sofia Pro;
                        font-size: 16px;
                        font-style: normal;
                        font-weight: 400;
                        line-height: 26px;
                        margin-right: 10px;">
                 ${textHtml(key)}
            </span>
            <span style="color: #000;
                    font-family: Sofia Pro;
                    font-size: 16px;
                    font-style: normal;
                    font-weight: 400;
                    line-height: 26px;">
                ${textHtml(value)}
            </span>
    </div>
        `
    )

}
exports.profileDetailsAndNameTime = ({ profile = "", name = "", time = "" }) => {
    return (
        ` <div style="margin:0 auto;display:flex">
            ${roundImage.roundImage(profile)}
            ${nameAndDateGet(name, time)}
     </div>`
    )
}

function nameAndDateGet(name = "", time = "") {
    return (
        `<div style="padding-left: 15px;">
            <span style="color: #535358;
                        font-family: Sofia Pro;
                        font-size: 16px;
                        font-style: normal;
                        font-weight: 400;
                        line-height: 30px;">
                ${textHtml(name)}
            </span>
            <span style="color: #535358;
                        font-family: Sofia Pro;
                        font-size: 14px;
                        font-style: normal;
                        font-weight: 300;
                        line-height: 30px;
                        margin-left: 5px;">
                             ${textHtml(time)}
            </span>
    </div>
        `

    )

}

exports.titleTextToChange = ({ title = "", oldValue = "", newValue = "" }) => {
    return (`<div> 
         ${textHtml(title)} <div><span>${textHtml(oldValue)}</span></div>  ->  <div><span >${textHtml(newValue)}</span></div>
        </div> 
        `)

}

exports.titleTextImageToChange = ({ title = "", oldValue = "", newValue = "", oldImage = "", newImage = "" }) => {
    return (`<div> 
         ${textHtml(title)} <div><img src="${imageSrc(oldImage)}" /><span>${textHtml(oldValue)}</span></div>  ->  <div><img src="${imageSrc(newImage)}" /><span >${textHtml(newValue)}</span></div>
        </div> 
        `)

}



exports.imageViewTD = (image = "", name = "") => {
    image = imageSrc(image) || imageSrc(APIURL + 'api/v1/getlogo?key=defaultuser')
    name = textHtml(name)
    return (`
    <p class="sub-p" style="text-size-adjust:100%;-ms-text-size-adjust:100%;-moz-text-size-adjust:100%;-webkit-text-size-adjust:9%;font-size:16px;line-height:1.4em;color: #4d4d4d; margin: 0 !important;">
    <img src="${image}" alt="${name}" width="40" border="0" style="border:0;height:auto;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;display: block; mso-hide: all; width: 35px;height: 35px; border-radius: 50%;">
  </p>
  `)
}

exports.userNameViewTD = (name = "") => {
    return (`
    <p class="sub-p" style="text-size-adjust:100%;-ms-text-size-adjust:100%;-moz-text-size-adjust:100%;-webkit-text-size-adjust:31%;font-size:16px;font-weight: 400;color: #4d4d4d; margin: 0 !important;">
    <font color="#535358">${textHtml(name)}</font>
  </p>
    `)
}

exports.dateViewTD = (date = "") => {
    return (
        `<p class="sub-p" style="text-size-adjust:100%;-ms-text-size-adjust:100%;-moz-text-size-adjust:100%;-webkit-text-size-adjust:60%;font-size:14px;color: #4d4d4d;font-weight: 300; margin: 0 !important;">
         <font color="#535358">${textHtml(date)}</font>
        </p>
        `
    )
}

exports.LabelAndValueTextOnly = (label = "", value = "") => {

    return (
        `
    <table width="100%" align="center" role="presentation" border="0" cellpadding="0" cellspacing="0" style="mso-table-lspace:0pt;mso-table-rspace:0pt;table-layout: fixed;">
        <tbody>
            <tr style="display:flex;align-items: center;">
                <td style="mso-table-lspace:0pt;mso-table-rspace:0pt; padding-left: 0; padding-right: 20px; width: 20%; min-width:0px;" align="left" valign="top">
                <font color="#818181">${textHtml(label)}</font>
                </td>
                <td style="mso-table-lspace:0pt;mso-table-rspace:0pt;padding-left: 0; padding-right: 0px; vertical-align: middle;width:80%;" align="left" valign="middle">
                    <div style="display:flex;align-items:center;">
                    <p style="display:inline-block;margin: 0;padding: 0px 7px;color: #000;font-size: 16px;line-height: 26px;border-radius: 4px;">${textHtml(value)}</p> 
                    </div>
                </td>
            </tr>
        </tbody>
    </table>
    `
    )
}



exports.messageTextOnly = (value = "") => {

    return (
        ` <table width="100%" align="center" role="presentation" border="0" cellpadding="0" cellspacing="0" style="mso-table-lspace:0pt;mso-table-rspace:0pt;table-layout: fixed;">
        <tbody>
          <tr style="display:flex;align-items: center;">
            <td style="mso-table-lspace:0pt;mso-table-rspace:0pt; padding-left: 0; padding-right: 20px; width: 100%; min-width:0px;" align="left" valign="top">
              <p>${commentHtml(value)}</p>
              </td>
          </tr>
      </tbody>
    </table>
        `
    )
}


exports.updateView = ({ value = "Status", oldValue = { backColor: "", color: "", name: "", image: "" }, newValue = { backColor: "", color: "", name: "", image: "" }, type = "image", }) => {
   
    return (
        `<table width="100%" align="center" role="presentation" border="0" cellpadding="0" cellspacing="0" style="mso-table-lspace:0pt;mso-table-rspace:0pt;table-layout: fixed;">
        <tbody>
          <tr style="display:flex;align-items: center;">
            <td style="mso-table-lspace:0pt;mso-table-rspace:0pt; padding-left: 0; padding-right: 20px; width: 12%; min-width:60px;" align="left" valign="top">
              <font color="#818181">${textHtml(value)}</font>
            </td>
            <td style="mso-table-lspace:0pt;mso-table-rspace:0pt;padding-left: 0; padding-right: 0px; vertical-align: middle;width:88%;" align="left" valign="middle">
                <div style="display:flex;align-items: center;">
                 ${oldValue?.name==""?"":manageRender(type, oldValue)}
                    ${oldValue?.name==""?"":`<p style="display:inline-block;margin: 0px 10px;"> 
                        <img src="https://s3.${awsRef.region}.wasabisys.com/${USERPROFILEBUCKET}/public_assets/email_arrow_right_alt.png" alt="right-arrow">
                    </p>`}
                    ${manageRender(type, newValue)}
                </div>
            </td>
        </tr>
      </tbody>
    </table>`
    )
}

exports.notificationCommonTemplate = (message) => {
    return (`<html>
      <head>
        <meta charset="utf-8">
        <meta http-equiv="x-ua-compatible" content="ie=edge">
        <title>Alian - hub</title>
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
        <table role="presentation" width="100%" align="left" border="0" cellpadding="0" cellspacing="0" style="mso-table-lspace:0pt;mso-table-rspace:0pt;width: 100%; background-color: #F3F6F6; margin: 0;" bgcolor="#F3F6F6">
            <tbody>
              <tr>
                <td class="body__content" align="left" width="100%" valign="top" style="mso-table-lspace:0pt;mso-table-rspace:0pt;color: #000000; font-family: Helvetica,Arial,sans-serif; font-size: 16px; line-height: 20px; padding-bottom: 0px; padding-top: 20px;">
                
                  <div style="margin: 0 auto; max-width: 600px; width: 100%; max-width: 640px; background-color: #FFFFFF; border-top-left-radius: 10px; border-top-right-radius: 10px; overflow:hidden;">
                  
                      <table role="presentation" border="0" align="center" cellpadding="0" cellspacing="0" width="100%" style="mso-table-lspace:0pt;mso-table-rspace:0pt;">
                        <tbody><tr>
                          <td width="100%" align="left" valign="top" style="mso-table-lspace:0pt;mso-table-rspace:0pt;padding: 0; background-color: #FFFFFF;" bgcolor="#FFFFFF">
                          
                          <!-- table for top LOGO -->
                            <div style="padding-bottom:0px; background-color: #FFFFFF;">
                              <table width="100%" align="center" role="presentation" border="0" cellpadding="0" cellspacing="0" style="mso-table-lspace:0pt;mso-table-rspace:0pt;table-layout: fixed;">
                                <tbody><tr>
                                  <td class="column col-sm-12" width="640" style="mso-table-lspace:0pt;mso-table-rspace:0pt;padding-top: 15px; padding-bottom: 15px;width: 100%; text-align: center;" align="center" valign="top">
                                    <a href="#" target="_blank" style="text-size-adjust:100%;-ms-text-size-adjust:100%;-moz-text-size-adjust:100%;-webkit-text-size-adjust:100%;text-decoration:none;text-decoration: none; margin: 0; color: #69CC15;">
                                      <span style="text-size-adjust:100%;-ms-text-size-adjust:100%;-moz-text-size-adjust:100%;-webkit-text-size-adjust:100%;margin: 0; text-decoration: none; color: #253D98;">
                                        <!-- ===== LOGO ===== -->
                                        <img alt="" title="" class="logo" src="${imageUrl}"/>
                                        <!-- ===== LOGO ===== -->
                                      </span>
                                    </a>
                                  </td>
                                </tr>
                              </tbody></table>
                            </div>
                          <!-- table for top LOGO End -->
                            <!-- Table for Top Title  -->
                            <div style="padding-right: 30px;padding-left: 30px;padding-bottom: 30px;padding-top: 30px; background-color: #F6F7FB;background-image: url('https://s3.${awsRef.region}.wasabisys.com/${USERPROFILEBUCKET}/public_assets/email_banner_icon.png');background-size: 100%;">
                            ${messageHtml(message)}
                            </div>
                            <!-- Table for Top Title End  -->
                            <div style="padding-bottom:0px; background-color: #F0F3FD;margin:0 auto;max-width:640px;">
                                <table width="100%" align="center" role="presentation" border="0" cellpadding="0" cellspacing="0" style="mso-table-lspace:0pt;mso-table-rspace:0pt;table-layout: fixed;">
                                    <tbody>
                                        <tr>
                                            <td class="column col-sm-12" width="640" style="mso-table-lspace:0pt;mso-table-rspace:0pt;padding-top: 25px; padding-bottom: 25px;width: 100%; text-align: center;" align="center" valign="top">
                                                <a href="#" target="_blank" style="text-size-adjust:100%;-ms-text-size-adjust:100%;-moz-text-size-adjust:100%;-webkit-text-size-adjust:100%;text-decoration:none;text-decoration: none; margin: 0; color: #69CC15;">
                                                <span style="text-size-adjust:100%;-ms-text-size-adjust:100%;-moz-text-size-adjust:100%;-webkit-text-size-adjust:100%;margin: 0; text-decoration: none;font-size: 16px;line-height: 22.4px; color: #6E7796;">
                                                    <!-- ===== LOGO ===== -->
                                                    © ${new Date().getFullYear()} Alianhub
                                                    <!-- ===== LOGO ===== -->
                                                </span>
                                                </a>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                          </td>
                        </tr>
                      </tbody></table>
                  <!-- ===== TABLE #3 ===== -->
                  
                  <!-- ===== TABLE #4 ===== -->
                  </div>
                
                
                
                </td>
              </tr>
          </tbody></table>
    
      </body>
    </html>`
    )
}


function Button(data) {
    return (
        `<p style="display:inline-block;margin: 0;padding: 5px 7px;background-color:${cssColor(data.backColor)};color: ${cssColor(data.color)};font-size: 13px;line-height: 19px;border-radius: 4px;">${textHtml(data.name)}</p> 
        `
    )
}

function ImageWithText(data) {
    return (
        ` <p style="display:inline-block;margin: 0;padding: 5px 7px;color: #000;font-size: 16px;line-height: 23px;"><img style="width:11px;height:auto;object-fit:contain;margin:0 10px" src="${imageSrc(data.image)}"/>${textHtml(data.name)}</p>`
    )
}

function TextOnly(data) {
    return (
        `<p style="display:inline-block;margin: 0;padding: 5px 7px;color: #000;font-size: 16px;line-height: 23px;">${textHtml(data.name)}</p>`
    )
}

function RoundImageWithText(data) {
    return (
        ` <p style="display:inline-block;margin: 0;padding: 5px 7px;color: #000;font-size: 16px;line-height: 23px;">${exports.imageViewTD(data.image)}<span style="margin-left:10px;"/>${textHtml(data.name)}</p>`
    )
}
function manageRender(type, value, isRight) {
    switch (type) {
        case "button":
            return Button(value)
        case "imageText":
            return ImageWithText(value)
        case "roundImageText":
            return RoundImageWithText(value)
        case "text":
            return TextOnly(value)
        default:
            return `<p></p>`
    }
}
