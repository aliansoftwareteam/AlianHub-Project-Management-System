const mongoose = require('mongoose');
const { schema } = require('../utils/mongo-handler/schema');

describe('a custom field saved without isDelete', () => {
    it('defaults to not deleted instead of failing the cast', () => {
        const CustomField = mongoose.model('CustomFieldDefaultsCheck', new mongoose.Schema(schema.customFields));
        const field = new CustomField({ fieldTitle: 'Budget', fieldType: 'text', type: 'project', global: false });

        expect(field.validateSync()).toBeUndefined();
        expect(field.isDelete).toBe(false);
    });
});
