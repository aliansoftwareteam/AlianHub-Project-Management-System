// SEC-05 — static SCIM 2.0 discovery documents. IdPs (Okta, Azure AD, etc.)
// probe these to learn capabilities before syncing users.

const spProviderConfig = (baseUrl) => ({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://help.alianhub.com',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Authentication via the SCIM bearer token issued in AlianHub settings.',
        primary: true,
    }],
    meta: { resourceType: 'ServiceProviderConfig', location: `${baseUrl}/ServiceProviderConfig` },
});

const resourceTypes = (baseUrl) => ([{
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
    id: 'User',
    name: 'User',
    endpoint: '/Users',
    schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
    meta: { resourceType: 'ResourceType', location: `${baseUrl}/ResourceTypes/User` },
}]);

const schemas = () => ([{
    id: 'urn:ietf:params:scim:schemas:core:2.0:User',
    name: 'User',
    description: 'User Account',
    attributes: [
        { name: 'userName', type: 'string', multiValued: false, required: true, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'server' },
        { name: 'name', type: 'complex', multiValued: false, required: false },
        { name: 'active', type: 'boolean', multiValued: false, required: false },
        { name: 'emails', type: 'complex', multiValued: true, required: false },
    ],
}]);

module.exports = { spProviderConfig, resourceTypes, schemas };
