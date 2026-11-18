// The non-human principals of the platform and the STEP_CREDENTIALS flag that
// puts them on rows. Free of requires, so Config/jwt.js, the AI core and the
// knowledge indexer can read it without pulling in the agent modules.

const ACTOR_SERVICE = 'service';
const SERVICES = Object.freeze(['engine', 'worker', 'indexer', 'router']);
const SERVICE_LABELS = Object.freeze({ engine: 'Workflow engine', worker: 'Workflow worker', indexer: 'Knowledge indexer', router: 'Model router' });
const SERVICE_ID_PREFIX = 'service:';
const STEP_CREDENTIAL_KIND = 'step_credential';
const FLAG_ON = ['on', 'true', '1', 'yes'];

const stepCredentialsEnabled = () => FLAG_ON.includes(String(process.env.STEP_CREDENTIALS || 'off').trim().toLowerCase());

const isService = (name) => SERVICES.includes(name);

const serviceIdOf = (service) => {
    if (!isService(service)) throw new Error(`unknown service identity "${service}": one of ${SERVICES.join(', ')}`);
    return `${SERVICE_ID_PREFIX}${service}`;
};

const looksLikeServiceIdentity = (raw) => typeof raw === 'string' && SERVICES.some((service) => raw === `${SERVICE_ID_PREFIX}${service}`);

/* The one-line hook for a component that writes its own rows: `{ [field]: 'service:<name>' }`
 * under the flag, nothing with it off, so a row written today keeps its shape. */
const serviceStamp = (service, field = 'actorId') => (stepCredentialsEnabled() ? { [field]: serviceIdOf(service) } : {});

module.exports = { ACTOR_SERVICE, SERVICES, SERVICE_LABELS, SERVICE_ID_PREFIX, STEP_CREDENTIAL_KIND, stepCredentialsEnabled, isService, serviceIdOf, looksLikeServiceIdentity, serviceStamp };
