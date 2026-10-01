const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

const CURRENCY_FIELDS = ['code', 'symbol', 'symbol_native', 'name', 'name_plural', 'decimal_digits', 'rounding'];

/* On a currency row `isDelete: true` means the company uses it: the settings screen sets it when a currency is added. */
const inUse = (row) => row.isDelete === true;

/* The default the company still uses, else the one currency it uses, else the default it switched off. */
const pickCurrency = (rows) => {
    const used = rows.filter(inUse);
    return used.find((row) => row.isDefault) || (used.length === 1 ? used[0] : null) || rows.find((row) => row.isDefault) || null;
};

const hasCurrency = (value) => Boolean(value) && typeof value === 'object' && typeof value.code === 'string' && value.code !== '';

/* What a project, a goal or an invoice starts in when nobody chose: `{}` in a company with no currency. */
const defaultCurrencyOf = async (companyId) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.CURRENCY_LIST,
        data: [{ $or: [{ isDefault: true }, { isDelete: true }] }, null, { lean: true }],
    }, 'find');
    const row = pickCurrency(Array.isArray(rows) ? rows : []);
    return row ? Object.fromEntries(CURRENCY_FIELDS.filter((field) => row[field] !== undefined).map((field) => [field, row[field]])) : {};
};

module.exports = { defaultCurrencyOf, hasCurrency };
