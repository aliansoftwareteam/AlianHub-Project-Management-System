import moment from "moment";

const getDateType = (seconds,user) => {
    if ((user.timeFormat) == "12") {
        return moment(new Date(Number(seconds))).format("hh:mm A");
    } else {
        return moment(new Date(Number(seconds))).format("HH:mm");
    }
}

export const prepareData = (trackObj,userObj) => {
    return new Promise((resolve, reject) => {
        try {
            let minuteArray = []
            let finalArray = [];
            let dt = Number(trackObj.prevscreenShot);
            minuteArray.push(getDateType(Number(trackObj.prevscreenShot),userObj))
            while (dt <= Number(trackObj.screenShotTime)) {
                minuteArray.push(getDateType(dt,userObj))  
                dt = new Date(new Date(dt).setSeconds(new Date(dt).getSeconds()+60)).getTime();
            }
            minuteArray.push(getDateType(Number(trackObj.screenShotTime),userObj))
            let finalMinuteArray = [...new Set(minuteArray)];
            finalMinuteArray.forEach((ele)=>{
                let min = trackObj.strokes.find((x)=> getDateType(Object.keys(x)[0],userObj) == ele)
                if (min) {
                    let obj = {
                        time : getDateType(Object.keys(min)[0],userObj),
                        keyBoard: Object.values(min)[0].keyboard,
                        mouse: Object.values(min)[0].mouse
                    }
                    finalArray.push(obj);
                } else {
                    finalArray.push({time: ele, keyBoard:0, mouse:0});
                }
            })
            resolve(finalArray);
        } catch (error) {
            reject(error);
        }
    })
}