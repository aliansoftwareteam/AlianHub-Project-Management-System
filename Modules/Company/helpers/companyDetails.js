const { checkWorkingDays } = require('./workingDays');

const PHONE_PATTERN = /^[0-9]{4,15}$/;

// Companies set up before phone became optional hold this in Cst_Phone, and the form sends it back unchanged.
const SETUP_PLACEHOLDER_PHONE = 'N/A';

const checkPhone = (updateObject) => {
    if (!('Cst_Phone' in updateObject)) return { ok: true, updateObject };
    const phone = updateObject.Cst_Phone === SETUP_PLACEHOLDER_PHONE ? '' : updateObject.Cst_Phone;
    if (phone !== '' && phone !== null && !(typeof phone === 'string' && PHONE_PATTERN.test(phone))) {
        return { ok: false, error: 'The phone number must be 4 to 15 digits, or left empty.' };
    }
    return { ok: true, updateObject: { ...updateObject, Cst_Phone: phone ?? '' } };
};

const checkWeek = (updateObject) => {
    if (!('workingDays' in updateObject)) return { ok: true, updateObject };
    const week = checkWorkingDays(updateObject.workingDays);
    return week.ok ? { ok: true, updateObject: { ...updateObject, workingDays: week.days } } : { ok: false, error: week.error };
};

// Phone, state and city are optional; a phone that is given must be 4 to 15 digits (E.164 without the country code).
const checkCompanyDetails = (updateObject) => {
    const phone = checkPhone(updateObject);
    return phone.ok ? checkWeek(phone.updateObject) : phone;
};

module.exports = { checkCompanyDetails };
