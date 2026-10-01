/* On a currency row `isDelete: true` means the company uses it: the settings screen sets it when a currency is added. */
const inUse = (row) => row.isDelete === true;

/* The default the company still uses, else the one currency it uses, else the default it switched off.
 * Empty until the list has loaded; the server then picks by the same rule (Modules/Company/helpers/companyCurrency.js). */
export const companyCurrency = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    const used = list.filter(inUse);
    return used.find((row) => row.isDefault) || (used.length === 1 ? used[0] : null) || list.find((row) => row.isDefault) || {};
};
