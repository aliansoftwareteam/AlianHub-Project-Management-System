const { APIURL } = require("../../../Config/config")
const { imageSrc } = require('../emailText')

exports.roundImage = (image = "") => {
    image = imageSrc(image) || imageSrc(APIURL + 'api/v1/getlogo?key=defaultuser')
    return`
    <div style="height: 50px;
width: 50px;
object-fit: cover;">
<img src="${image}"
style="border-radius: 50px;
width: 40px;
height: 40px;">
</div>
    `
}