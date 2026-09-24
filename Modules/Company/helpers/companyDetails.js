const PHONE_PATTERN = /^[0-9]{4,15}$/;

// Companies set up before phone became optional hold this in Cst_Phone, and the form sends it back unchanged.
const SETUP_PLACEHOLDER_PHONE = 'N/A';

// Phone, state and city are optional; a phone that is given must be 4 to 15 digits (E.164 without the country code).
const checkCompanyDetails = (updateObject) => {
    if (!('Cst_Phone' in updateObject)) return { ok: true, updateObject };
    const phone = updateObject.Cst_Phone === SETUP_PLACEHOLDER_PHONE ? '' : updateObject.Cst_Phone;
    if (phone !== '' && phone !== null && !(typeof phone === 'string' && PHONE_PATTERN.test(phone))) {
        return { ok: false, error: 'The phone number must be 4 to 15 digits, or left empty.' };
    }
    return { ok: true, updateObject: { ...updateObject, Cst_Phone: phone ?? '' } };
};

module.exports = { checkCompanyDetails };
