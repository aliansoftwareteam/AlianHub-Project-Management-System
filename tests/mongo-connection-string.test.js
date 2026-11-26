const { withDatabase } = require('../utils/mongo-handler/connectionString');

describe('the database name in a connection string', () => {
    it('goes after the host', () => {
        expect(withDatabase('mongodb://localhost:27017', 'global')).toBe('mongodb://localhost:27017/global');
        expect(withDatabase('mongodb://localhost:27017//', 'global')).toBe('mongodb://localhost:27017/global');
    });

    it('goes before the query, so the options still reach the driver', () => {
        expect(withDatabase('mongodb://a.example:27017,b.example:27017/?replicaSet=rs0&tls=true', 'c1'))
            .toBe('mongodb://a.example:27017,b.example:27017/c1?replicaSet=rs0&tls=true');
        expect(withDatabase('mongodb+srv://cluster.example.net/?retryWrites=true/', 'c1')).toBe('mongodb+srv://cluster.example.net/c1?retryWrites=true');
    });

    it('adds authSource only when asked and not already given', () => {
        expect(withDatabase('mongodb://localhost:27017', 'c1', { authSource: 'admin' })).toBe('mongodb://localhost:27017/c1?authSource=admin');
        expect(withDatabase('mongodb://h:27017/?authSource=users', 'c1', { authSource: 'admin' })).toBe('mongodb://h:27017/c1?authSource=users');
        expect(withDatabase('mongodb+srv://cluster.example.net', 'c1')).toBe('mongodb+srv://cluster.example.net/c1');
    });
});
