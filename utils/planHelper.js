const { default: mongoose } = require('mongoose');
const NodeCache = require( "node-cache" );
const cache = new NodeCache({ stdTTL: 3600 });
const { getCompanyDataFun } = require("../modules/company/controller/update-company")

exports.getCachedCompanyData = async(companyId) => {
    return new Promise(async(resolve,reject) => {
        try {
            let cachedCompanyData = cache.get(companyId);
            if (!cachedCompanyData) {

                try {
                    const response = await getCompanyDataFun([companyId]);

                    if (!response) {
                        resolve({ success: false, message: "Company data not found" });
                        return;
                    }

                    cache.set(companyId, response[0]);
                    resolve({success: true, data: response[0]})
                } catch (error) {
                    console.error(`Error fetching company data: ${error}`);
                    resolve({success: false, message: "Error fetching company data"})
                }
            }else{
                resolve({success: true, data: cachedCompanyData})
            }
        } catch (error) {
            reject(error);
        }
    })
}