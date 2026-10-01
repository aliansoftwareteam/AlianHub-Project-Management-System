const { getCompanyDataFun } = require('../controller/updateCompany');
const { weekendDaysFor } = require('./workingDays');

const companyWeekendDays = async (companyId) => {
    const [company] = await getCompanyDataFun([String(companyId)]);
    return weekendDaysFor(company);
};

module.exports = { companyWeekendDays };
