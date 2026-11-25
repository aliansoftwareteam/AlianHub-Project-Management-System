// A non-SRV Atlas string must carry tls and replicaSet itself, so the database name goes before its query.
const withDatabase = (url, db, { authSource } = {}) => {
    const [head, query = ''] = String(url).replace(/\/+$/, '').split('?');
    const params = new URLSearchParams(query.replace(/\/+$/, ''));
    if (authSource && !params.has('authSource')) params.set('authSource', authSource);
    const qs = params.toString();
    return `${head.replace(/\/+$/, '')}/${db}${qs ? `?${qs}` : ''}`;
};

module.exports = { withDatabase };
