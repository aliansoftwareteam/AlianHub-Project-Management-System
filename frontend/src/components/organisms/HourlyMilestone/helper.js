import { apiRequest } from '@/services';
import * as env from '@/config/env';

export function calendar() {
    function calendarRange(startDate,milestoneArray,billingPeriod,selectCurrentYear,endDateCal){
        try{
            if(billingPeriod === "Monthly"){
                return new Promise((resolve, reject) => {
                    const projectStartDate = startDate ? startDate.seconds ? new Date(startDate.seconds * 1000) : new Date(startDate) : '';
                    let monthlyOrweeklyRanges = [];
                    if(projectStartDate){
                        let currentDate = new Date(projectStartDate);
                        let endDate = endDateCal ? endDateCal : new Date();
                        while (currentDate <= endDate) {
                            // Move to the next month
                            currentDate.setMonth(currentDate.getMonth() + 1,1); 
                            // Initialize the start and end dates of the current month
                            var currentMonthStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
                            var currentMonthEnd = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() + 1, 0, 23, 59, 59);
                            monthlyOrweeklyRanges.push({
                                start:currentMonthStart,
                                end:currentMonthEnd
                            });
                        }
                        if(milestoneArray && milestoneArray.length){
                            // filter the date which is already in milestoneArray
                            let filteredArray = monthlyOrweeklyRanges.filter(item1 => {
                                return !milestoneArray.some(item2 => (item2.startDate ? item2.startDate.seconds ? new Date(item2.startDate.seconds * 1000) : new Date(item2.startDate) : '').getTime() === (item1.start).getTime());
                            });
                            monthlyOrweeklyRanges = filteredArray
                        }
                        if(monthlyOrweeklyRanges && monthlyOrweeklyRanges.length){
                            const newValue = {};
                            // Iterate through the Value array and group the items by year and month
                            monthlyOrweeklyRanges.forEach(item => {
                                // Extract the year and month from the Start date
                                const startDate = new Date(item.start);
                                const year = startDate.getFullYear();
                                const month = startDate.toLocaleDateString('en-us', { month: 'short' });
                    
                                // If the year key doesn't exist in the newValue object, create it
                                if (!newValue[year]) {
                                    newValue[year] = {};
                                }
                    
                                // If the month key doesn't exist in the year object, create it
                                if (!newValue[year][month]) {
                                    newValue[year][month] = [];
                                }
                    
                                // Format the date strings and add the item to the month array
                                const formattedItem = {
                                    start: new Date(item.start).toLocaleDateString('en-us', { day: '2-digit', month: 'short', year: 'numeric' }),
                                    end: new Date(item.end).toLocaleDateString('en-us', { day: '2-digit', month: 'short', year: 'numeric' }),
                                };
                                newValue[year][month].push(formattedItem);
                            });
                            
                            let monthValueRange = '';
                            let rangeValueMonthly = '';
                            let hourlyCalendarModel = {};
                            let selectedmonth = ''
                            monthValueRange = Object.keys(newValue)[0];
                            selectedmonth = Object.keys(newValue[monthValueRange])[0];
                            rangeValueMonthly = newValue[monthValueRange][selectedmonth];
                            hourlyCalendarModel = rangeValueMonthly[0];
    
                            // if we want to open the calendar on the base of the current month then uncomment the below code
                            // the below commented code is needed

                            if(selectCurrentYear){
                                let currentDay = new Date();
                                for (const temp in newValue) {
                                    if (temp === currentDay.getFullYear().toString()) {
                                      monthValueRange = temp;
                                      break;
                                    }
                                    monthValueRange = Object.keys(newValue)[0];
                                }
                            }
                            rangeValueMonthly = newValue[monthValueRange];
                            let obj = {
                                'rangeValueMonthly':rangeValueMonthly,
                                'monthValueRange':monthValueRange,
                                'hourlyCalendarModel':hourlyCalendarModel,
                                'monthlyOrweeklyRangesValue':newValue,
                                'selectedmonth':selectedmonth
                            }
                            return resolve(obj)
                        }else{
                            return resolve({});
                        }
                    }else{
                        reject()
                        return {};
                    }
                });
            }
        } catch(error) {
            console.error("error",error)
        }
    }
    function calendarRangeWeekly(startDate,milestoneArray,milestoneWeeklyRange){
        try{
            return new Promise((resolve, reject) => {
                const projectStartDate = startDate ? startDate.seconds ? new Date(startDate.seconds * 1000) : new Date(startDate) : '';
                if(projectStartDate){
                    let disableStartEndDate = [];
                    let currentDate = null;
                    let endDate = new Date();
                    let monthlyOrweeklyRanges = [];
                    let obj = {};
                    currentDate = new Date(startDate);
                    if(milestoneWeeklyRange === 'Mon - Sun'){
                        if(startDate.getDay() === 0){
                            currentDate.setDate(startDate.getDate() - 7);
                        }else{
                            currentDate.setDate(startDate.getDate() - (startDate.getDay()));
                        }
                    } else{
                        currentDate.setDate(startDate.getDate() - (startDate.getDay()) - 1);
                    }
                    // Loop through each week and add the start and end dates to the monthlyOrweeklyRanges array
                    while (currentDate < endDate) {
                        currentDate.setDate(currentDate.getDate() + 7);
                        const weekStart = new Date(currentDate);
                        weekStart.setDate(currentDate.getDate() - 6);
                        const weekEnd = new Date(Math.min(currentDate, endDate));
                        monthlyOrweeklyRanges.push({
                            start:weekStart,
                            end:weekEnd
                        });
                    }
                    if(milestoneArray && milestoneArray.length){
                        let filteredArray = monthlyOrweeklyRanges.filter(item1 => {
                            return !milestoneArray.some(item2 => (item2.startDate ? item2.startDate.seconds ? new Date(item2.startDate.seconds * 1000) : new Date(item2.startDate) : '').setHours(0,0,0,0) === (item1.start).setHours(0,0,0,0));
                        });
                        monthlyOrweeklyRanges = filteredArray
                        milestoneArray.forEach((ele)=>{
                            ele.startDate = ele.startDate ? ele.startDate.seconds ? new Date(ele.startDate.seconds * 1000) : new Date(ele.startDate) : '';
                            ele.endDate = ele.endDate ? ele.endDate.seconds ? new Date(ele.endDate.seconds * 1000) : new Date(ele.endDate) : '';
                            disableStartEndDate.push({
                                start:ele.startDate,
                                end:ele.endDate
                            })
                        })
                    }
                    obj = {
                        'disableStartEndDate':disableStartEndDate,
                        'monthlyOrweeklyRanges':monthlyOrweeklyRanges
                    }
                    return resolve(obj);
                }else{
                    reject();
                    return {}
                }
            });
        } catch(error){
            console.error("error",error)
        }
    }
    function gettingTotalHours(milestoneArray,projectId){
        try{
            if(projectId && milestoneArray && milestoneArray.length){
                return new Promise((resolve, reject) => {
                    
                    let objectvalue = {};
                    try{
                        let count = 0;
                        const myFunc = async (row) => {
                            if (count >= milestoneArray.length) {
                                return resolve(objectvalue);
                            } else{
                                let convertStart = row.startDate.seconds ? new Date(row.startDate.seconds * 1000) : row.startDate;
                                let convertEnd = row.endDate.seconds ? new Date(row.endDate.seconds * 1000) : row.endDate;
                                row.startDate = new Date(convertStart.setHours(0,0,0));
                                row.endDate = new Date(convertEnd.setHours(23,59,59));
                                let startDate = row.startDate;
                                let endDate = row.endDate;
                                let axiosObj = {
                                    startDate: startDate,
                                    endDate: endDate,
                                    projectId: projectId
                                }
                                apiRequest("post", `${env.TIMESHEET}/milestone`,axiosObj)
                                .then((res)=>{
                                    if(res.status === 200){
                                        const timeSheet = res.data;
                                        if(timeSheet && timeSheet.length){
                                            try {
                                                let assigneeArray = [];
                                                allUserData(timeSheet).then((obj)=>{
                                                    if(obj.individualTotals.length > 0){
                                                        // BUG-017 / #71 fix: body just does sync array.push.
                                                        obj.individualTotals.forEach((element) => {
                                                            assigneeArray.push({
                                                                id:element.user,
                                                                individualLogTime:element.total
                                                            })
                                                        });
                                                    }
                                                    objectvalue = {
                                                        ...objectvalue,
                                                        [row._id]: {
                                                            "assigneeArray":assigneeArray,
                                                            "loggedHours":obj.sumValue
                                                        }
                                                    };
                                                    count++;
                                                    myFunc(milestoneArray[count]);
                                                }).catch(()=>{
                                                    count++;
                                                    myFunc(milestoneArray[count]);
                                                });
                                            } catch (error) {
                                                count++;
                                                myFunc(milestoneArray[count]);
                                                console.error("error",error);
                                            }
                                        } else{
                                            objectvalue = {
                                                ...objectvalue,
                                                [row._id]: {
                                                    "assigneeArray":[],
                                                    "loggedHours":0
                                                }
                                            };
                                            count++;
                                            myFunc(milestoneArray[count]);
                                        }
                                    }
                                    else{
                                        objectvalue = {
                                            ...objectvalue,
                                            [row._id]: {
                                                "assigneeArray":[],
                                                "loggedHours":0
                                            }
                                        };
                                        count++;
                                        myFunc(milestoneArray[count]);
                                    }
                                });
                            }
                        }
                        myFunc(milestoneArray[count])
                    } catch (error){
                        reject(error)
                    }
                });
            }
        }catch (error){
            console.error("error",error)
        }
    }
    function allUserData (finalArray) {
        try{
            return new Promise((myResolve, myReject) => {
                try{
                    let totals = {};
                    let sumValue = 0;
                    for (const transaction of finalArray) {
                        const user = transaction.Loggeduser;
                        const amount = Number(transaction.LogTimeDuration);
                        if (totals[user]) {
                            totals[user] += amount;
                        } else {
                            totals[user] = amount;
                        }
                        sumValue += Number(amount);
                    }
                    let individualTotals = [];
                    for (const user in totals) {
                        individualTotals.push({ user, total: totals[user] });
                    }
                    if(Object.keys(totals).length === individualTotals.length){
                        let obj = {
                            'individualTotals':individualTotals,
                            'sumValue':sumValue
                        }
                        myResolve(obj);
                    }
                } catch (error) {
                    console.error("error",error);
                    myReject();
                }
            });
        } catch(error){
            console.error('error',error)
        }
    }
    function UserArray (calStartDate,calEndDate,projectId){
        return new Promise((resolve, reject) => {
            try{
                let startVal = calStartDate.setHours(0,0,0);
                let endVal = calEndDate.setHours(23,59,59)
                let startDate = new Date(startVal);
                let endDate = new Date(endVal);
                let totalSumValue = 0
                let axiosObj = {
                    startDate: startDate,
                    endDate: endDate,
                    projectId: projectId
                }
                apiRequest("post", `${env.TIMESHEET}/milestone`,axiosObj)
                .then((res)=>{
                    if(res.status === 200){
                        const timesheet = res.data;
                        if(timesheet && timesheet?.length){
                            try {
                                let totals = {};
                                let sumValue = 0;
                                for (const transaction of timesheet) {
                                    const user = transaction.Loggeduser;
                                    const amount = Number(transaction.LogTimeDuration);
                                    if (totals[user]) {
                                        totals[user] += amount;
                                    } else {
                                        totals[user] = amount;
                                    }
                                    sumValue += Number(amount);
                                    totalSumValue += Number(amount);
                                }
                                let individualTotals = [];
                                let assigneeArray = [];
                                for (const user in totals) {
                                    individualTotals.push({ user, total: totals[user] });
                                }
                                if(individualTotals && individualTotals.length){
                                    individualTotals.forEach((element)=>{
                                        assigneeArray.push({
                                            id:element.user,
                                            individualLogTime:element.total,
                                        }) 
                                    })
                                }
                                let obj = {
                                    'userArray':assigneeArray,
                                    'individualLogTime':sumValue,
                                    'totalSumValue':totalSumValue
                                }
                                resolve(obj);
                            } catch(error){
                                console.error("error",error)
                            }
                        }else{
                            resolve({});
                        }
                    }else{
                        resolve({});
                    }
                })
            } catch(error){
                console.error('error',error);
                reject(error);
            }
        })
    }
    return {
        calendarRange,
        calendarRangeWeekly,
        gettingTotalHours,
        allUserData,
        UserArray
    }
}