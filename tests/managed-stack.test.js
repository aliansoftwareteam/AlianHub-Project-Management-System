const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { loadTiers, loadTemplate, memoryMb, stackValues, render, renderStack, main } = require('../deploy/managed/render');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const DIGEST = `sha256:${'c'.repeat(64)}`;
const ID = 'ins_01jd3k8w0000000000000000';

const meta = (overrides = {}) => ({
    instanceId: ID,
    subdomain: 'acme',
    tier: 'starter',
    version: '14.40.0',
    image: 'ghcr.io/aliansoftwareteam/alianhub',
    imageDigest: DIGEST,
    ...overrides
});

describe('self-hosted docker-compose.yml', () => {
    const base = yaml.load(read('docker-compose.yml'));
    const legacy = yaml.load(read('docker-compose.legacy.yml'));

    test('fixes no container, volume or network name, so each project gets its own', () => {
        expect(Object.values(base.services).filter((s) => s.container_name)).toEqual([]);
        expect(Object.values(base.volumes).filter((v) => v && v.name)).toEqual([]);
        expect(Object.values(base.networks).filter((n) => n && n.name)).toEqual([]);
    });

    test('the legacy override restores every name earlier releases used', () => {
        expect(Object.keys(legacy.volumes).sort()).toEqual(Object.keys(base.volumes).sort());
        for (const [key, volume] of Object.entries(legacy.volumes)) expect(volume.name).toBe(key);
        expect(legacy.networks.alianhub.name).toBe('alianhub');
        expect(legacy.services.app.container_name).toBe('${ALIANHUB_APP_CONTAINER:-alianhub}');
        expect(legacy.services.mongo.container_name).toBe('${ALIANHUB_MONGO_CONTAINER:-alianhub-mongo}');
        expect(Object.keys(legacy.services).every((name) => base.services[name])).toBe(true);
    });
});

describe('managed compose template', () => {
    const tiers = loadTiers();

    test.each(Object.keys(loadTiers().tiers))('renders the %s tier with every placeholder filled', (tier) => {
        const result = renderStack(meta({ tier }));
        expect(result.problems).toEqual([]);
        expect(result.compose).not.toMatch(/\$\{/);
        const doc = yaml.load(result.compose);
        const limits = tiers.tiers[tier];
        expect(doc.name).toBe(`t_${ID}`);
        expect(doc.services.app.image).toBe(`ghcr.io/aliansoftwareteam/alianhub@${DIGEST}`);
        expect(doc.services.app.deploy.resources.limits).toMatchObject({ cpus: limits.app.cpus, memory: limits.app.memory });
        expect(doc.services.mongo.deploy.resources.limits).toMatchObject({ cpus: limits.mongo.cpus, memory: limits.mongo.memory });
        expect(doc.services.mongo.command).toEqual(['--wiredTigerCacheSizeGB', limits.mongo.cacheGb, '--quiet']);
        expect(doc.services.mongo.image).toBe(`mongo:7.0.${tiers.mongo.patch}`);
        expect(doc.services.app.environment.NODE_OPTIONS).toBe(`--max-old-space-size=${Math.floor(memoryMb(limits.app.memory) * 0.75)}`);
        expect(doc.services.app.labels[`traefik.http.routers.t_${ID}.rule`]).toBe('Host(`acme.alianhub.com`)');
        expect(doc.services.app.labels['com.alianhub.tier']).toBe(tier);
    });

    test('isolates the tenant: read-only app, no capabilities, Mongo only on the internal network', () => {
        const doc = yaml.load(renderStack(meta()).compose);
        expect(doc.services.app.read_only).toBe(true);
        expect(doc.services.app.cap_drop).toEqual(['ALL']);
        expect(doc.services.app.security_opt).toEqual(['no-new-privileges:true']);
        expect(doc.services.mongo.networks).toEqual(['internal']);
        expect(doc.services.mongo.ports).toBeUndefined();
        expect(doc.services.app.ports).toBeUndefined();
        expect(doc.networks).toEqual({ internal: { internal: true }, edge: { external: true } });
        expect(JSON.stringify(doc)).not.toContain('docker.sock');
    });

    /* Every directory the app writes to under a read-only root must be a tmpfs or a volume here,
     * and exist in the image (Dockerfile) so a volume starts owned by the node user. */
    test('mounts every writable path the image prepares', () => {
        const doc = yaml.load(renderStack(meta()).compose);
        const mounts = [
            ...doc.services.app.tmpfs.map((t) => t.split(':')[0]),
            ...doc.services.app.volumes.map((v) => v.split(':')[1])
        ];
        expect(mounts.sort()).toEqual(['/app/backups', '/app/log', '/app/thumbnails', '/app/wasabiUploads', '/app/wasabiUploadsLocal/exports', '/tmp']);
        const dockerfile = read('Dockerfile');
        for (const mount of mounts.filter((m) => m.startsWith('/app/'))) {
            expect(dockerfile).toContain(mount.replace('/app/', ''));
        }
    });

    test('takes limits from meta.json over the tier, and checks them', () => {
        const { values } = stackValues(meta({ limits: { appMemory: '1536m', mongoCacheGb: '0.5', mongoMemory: '1g' } }), tiers);
        expect(values).toMatchObject({ APP_MEM: '1536m', NODE_HEAP_MB: 1152, MONGO_CACHE_GB: '0.5', MONGO_MEM: '1g', APP_CPUS: '1.0' });
        expect(stackValues(meta({ limits: { mongoCacheGb: '1' } }), tiers).problems).toEqual(['limits.mongoCacheGb must be at most half of limits.mongoMemory']);
        expect(stackValues(meta({ limits: { appMemory: '100m' } }), tiers).problems).toEqual(['limits.appMemory must be at least 256m (e.g. 512m, 1g)']);
    });

    test('refuses meta that could break out of the template', () => {
        const problems = stackValues(meta({
            instanceId: 'ins_ABC',
            hostname: 'acme.alianhub.com`) || Host(`evil.com',
            tier: 'platinum',
            version: 'latest',
            image: 'ghcr.io/aliansoftwareteam/alianhub:latest',
            imageDigest: 'sha256:abc',
            mongoPatch: '1; rm -rf /'
        }), tiers).problems;
        expect(problems).toEqual([
            'instanceId must be "ins_" followed by 20 to 32 lowercase letters or digits',
            'hostname (or subdomain) must be a lowercase DNS name',
            'tier must be one of starter, pro, business',
            'version must be a semantic version',
            'image must be a repository reference without a tag or digest',
            'imageDigest must be sha256: followed by 64 hex characters',
            'mongoPatch must be a number'
        ]);
    });

    test('accepts the registries hosts pull from', () => {
        for (const image of ['ghcr.io/aliansoftwareteam/alianhub', 'registry.digitalocean.com/alianhub/alianhub', 'localhost:5000/alianhub']) {
            expect(stackValues(meta({ image }), tiers).problems).toEqual([]);
        }
    });

    test('names a placeholder the values do not fill', () => {
        expect(() => render('a ${KNOWN} b ${UNKNOWN}', { KNOWN: 1 })).toThrow('template placeholders without a value: UNKNOWN');
        expect(loadTemplate().match(/\$\{([A-Z0-9_]+)\}/g).every((p) => p.slice(2, -1) in renderStack(meta()).values)).toBe(true);
    });

    test('the CLI writes compose.yml into the instance directory and refuses a mismatched one', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));
        const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        try {
            const dir = path.join(root, ID);
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta()));
            expect(main(['node', 'render.js', dir])).toBe(0);
            expect(main(['node', 'render.js', dir])).toBe(0);
            expect(fs.readFileSync(path.join(dir, 'compose.yml'), 'utf8')).toBe(renderStack(meta()).compose);

            const wrong = path.join(root, 'ins_00000000000000000000000000');
            fs.mkdirSync(wrong);
            fs.writeFileSync(path.join(wrong, 'meta.json'), JSON.stringify(meta()));
            expect(main(['node', 'render.js', wrong])).toBe(2);
            expect(fs.existsSync(path.join(wrong, 'compose.yml'))).toBe(false);
        } finally {
            out.mockRestore();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
