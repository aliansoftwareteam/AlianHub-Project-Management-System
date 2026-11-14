require('./fixtures/mcpFlagsOff');
const integrations = require('../Modules/Integrations/controller');

const flagged = async (value) => {
    process.env.CONNECTORS = value;
    let body;
    await integrations.listCatalog({ headers: {}, uid: 'u1' }, { send: (b) => { body = b; return b; }, status() { return this; } });
    return body;
};

/* The connection cards render on a flag the catalogue carries, so the flag has to match the route condition it
 * stands in for: the connect/members routes exist only where a registry provider is named. */
describe('the catalogue says when a registry provider is named', () => {
    const before = process.env.CONNECTORS;
    afterAll(() => { process.env.CONNECTORS = before; });

    it('says nothing of a registry provider while none is named', async () => {
        const body = await flagged('');
        expect(body.status).toBe(true);
        expect(body.registryConnectors).toBeUndefined();
    });

    it('flags it once a registry provider is named', async () => {
        expect((await flagged('google')).registryConnectors).toBe(true);
    });

    it('counts Slack as a registry provider, alone or with Google', async () => {
        expect((await flagged('slack')).registryConnectors).toBe(true);
        expect((await flagged('slack google')).registryConnectors).toBe(true);
    });

    it('lists the named registry providers, so the company app card shows wherever its routes exist', async () => {
        expect((await flagged('google dropbox')).connectors).toEqual(['dropbox', 'google']);
        expect((await flagged('slack')).connectors).toEqual(['slack']);
    });

    it('lists no name this server has no provider for, the old google_calendar among them', async () => {
        const body = await flagged('google_calendar teleport');
        expect(body.connectors).toBeUndefined();
        expect(body.registryConnectors).toBeUndefined();
    });
});
