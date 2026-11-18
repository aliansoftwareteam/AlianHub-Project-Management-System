/* Where a file lands: a bucket per workspace as self-hosted installs have it, or one bucket and a
 * prefix per instance as AlianHub Cloud runs it. The S3_* names win over the Wasabi names they replace. */
const { resolveS3Config, normalisePrefix, prefixProblem, touchesStorage } = require('../common-storage/s3Config');
const { layoutOf, PUBLIC_OWNER } = require('../common-storage/s3Layout');

const COMPANY = '6731a0c2a1b2c3d4e5f60718';
const KEY = 'Project/6731a0c2a1b2c3d4e5f60801/Sprint/s1/Attachment/20261028T101010000Z_notes.pdf';

const WASABI_ENV = {
    STORAGE_TYPE: 'wasabi',
    WASABIENDPOINT: 'https://s3.eu-central-1.wasabisys.com',
    WASABI_REGION: 'eu-central-1',
    WASABI_ACCESS_KEY: 'OLD-AK',
    WASABI_SECRET_ACCESS_KEY: 'OLD-SK',
    USERPROFILEBUCKET: 'acme-profiles',
};
const HOSTED_ENV = {
    STORAGE_TYPE: 's3',
    S3_ENDPOINT: 'https://s3.ap-southeast-1.wasabisys.com',
    S3_REGION: 'ap-southeast-1',
    S3_BUCKET: 'alianhub-cloud-tenants-ap-southeast-1',
    S3_PREFIX: 'ins_01jd3k8w/',
    S3_ACCESS_KEY: 'AK',
    S3_SECRET_KEY: 'SK',
};

describe('the storage configuration', () => {
    it('reads an install that only has the Wasabi names exactly as before', () => {
        expect(resolveS3Config(WASABI_ENV)).toMatchObject({
            endpoint: 'https://s3.eu-central-1.wasabisys.com', region: 'eu-central-1', accessKeyId: 'OLD-AK', secretAccessKey: 'OLD-SK',
            profileBucket: 'acme-profiles', bucket: '', prefix: '', prefixMode: false, forcePathStyle: false, publicBaseUrl: '',
        });
    });

    it('prefers each S3_* name over its Wasabi fallback, one by one', () => {
        const cfg = resolveS3Config({ ...WASABI_ENV, S3_ACCESS_KEY: 'NEW-AK', S3_REGION: '  blr1 ' });
        expect(cfg).toMatchObject({ accessKeyId: 'NEW-AK', secretAccessKey: 'OLD-SK', region: 'blr1', endpoint: WASABI_ENV.WASABIENDPOINT });
    });

    it('treats an empty S3_* value as unset, so an empty line in .env keeps the Wasabi value', () => {
        expect(resolveS3Config({ ...WASABI_ENV, S3_ENDPOINT: '', S3_ACCESS_KEY: '  ' })).toMatchObject({ endpoint: WASABI_ENV.WASABIENDPOINT, accessKeyId: 'OLD-AK' });
    });

    it('turns prefix mode on with S3_BUCKET alone, and reads the switches', () => {
        expect(resolveS3Config({ S3_BUCKET: 'own-bucket' })).toMatchObject({ bucket: 'own-bucket', prefix: '', prefixMode: true });
        expect(resolveS3Config({ S3_FORCE_PATH_STYLE: 'TRUE', S3_PUBLIC_BASE_URL: 'https://cdn.example.com/ins_01/' }))
            .toMatchObject({ forcePathStyle: true, publicBaseUrl: 'https://cdn.example.com/ins_01', prefixMode: false });
    });

    it('ends a prefix with exactly one slash and refuses one that could climb out of its folder', () => {
        expect(normalisePrefix('ins_01')).toBe('ins_01/');
        expect(normalisePrefix('/tenants/ins_01/')).toBe('tenants/ins_01/');
        expect(normalisePrefix('  ')).toBe('');
        expect(prefixProblem('tenants/ins_01')).toBeNull();
        expect(prefixProblem('')).toBeNull();
        for (const bad of ['a/../b', 'a//b', './a', 'a\\b']) expect(prefixProblem(bad)).toBe('prefix');
    });

    it('knows which settings concern storage', () => {
        expect(touchesStorage(['S3_SECRET_KEY'])).toBe(true);
        expect(touchesStorage(['WASABI_ACCESS_KEY', 'APP_NAME'])).toBe(true);
        expect(touchesStorage(['APP_NAME', 'WEBURL'])).toBe(false);
    });
});

describe('a bucket per workspace (S3_BUCKET empty)', () => {
    const layout = layoutOf(resolveS3Config(WASABI_ENV));

    it('keeps a company file in the bucket named after the company, under its own key', () => {
        expect(layout.locate(COMPANY, KEY)).toEqual({ Bucket: COMPANY, Key: KEY });
        expect(layout.listing(COMPANY)).toEqual({ Bucket: COMPANY });
        expect(layout.copySource(layout.locate(COMPANY, 'a b/c.png'))).toBe(`${COMPANY}/a b/c.png`);
    });

    it('keeps avatars and public files in USERPROFILEBUCKET', () => {
        expect(layout.locate(PUBLIC_OWNER, 'public_assets/email_banner_icon.png')).toEqual({ Bucket: 'acme-profiles', Key: 'public_assets/email_banner_icon.png' });
    });

    it('addresses public email images exactly as the templates always did', () => {
        expect(layout.publicUrl('public_assets/email_banner_icon.png')).toBe('https://s3.eu-central-1.wasabisys.com/acme-profiles/public_assets/email_banner_icon.png');
    });

    it('passes a key through untouched, as before', () => {
        expect(layout.locate(COMPANY, '../odd/key').Key).toBe('../odd/key');
        expect(layout.logicalKey(COMPANY, KEY)).toBe(KEY);
        expect(layout.owns({ Bucket: 'anything', Key: 'x' })).toBe(true);
    });
});

describe('one bucket and a prefix (S3_BUCKET set)', () => {
    const layout = layoutOf(resolveS3Config(HOSTED_ENV));
    const bucket = HOSTED_ENV.S3_BUCKET;

    it('puts a company file under <prefix><companyId>/ in the shared bucket', () => {
        expect(layout.locate(COMPANY, KEY)).toEqual({ Bucket: bucket, Key: `ins_01jd3k8w/${COMPANY}/${KEY}` });
        expect(layout.listing(COMPANY)).toEqual({ Bucket: bucket, Prefix: `ins_01jd3k8w/${COMPANY}/` });
    });

    it('puts avatars and public files under <prefix>public/', () => {
        expect(layout.locate(PUBLIC_OWNER, 'avatar.png')).toEqual({ Bucket: bucket, Key: 'ins_01jd3k8w/public/avatar.png' });
    });

    it('reads a listed key back into the key the database holds, and nothing outside the area', () => {
        expect(layout.logicalKey(COMPANY, `ins_01jd3k8w/${COMPANY}/${KEY}`)).toBe(KEY);
        expect(layout.logicalKey(COMPANY, `ins_01jd3k8w/6731b7000000000000000000/${KEY}`)).toBeNull();
        expect(layout.logicalKey(COMPANY, `ins_other/${COMPANY}/${KEY}`)).toBeNull();
        expect(layout.ownerOfKey(`ins_01jd3k8w/${COMPANY}/${KEY}`)).toBe(COMPANY);
        expect(layout.ownerOfKey(`ins_other/${COMPANY}/${KEY}`)).toBeNull();
    });

    it('owns only what lies under its prefix in its bucket', () => {
        expect(layout.owns(layout.locate(COMPANY, KEY))).toBe(true);
        expect(layout.owns({ Bucket: bucket, Key: 'ins_other/x' })).toBe(false);
        expect(layout.owns({ Bucket: 'another', Key: 'ins_01jd3k8w/x' })).toBe(false);
        expect(layout.instanceListing()).toEqual({ Bucket: bucket, Prefix: 'ins_01jd3k8w/' });
    });

    it('refuses a key or a company id that could reach another area', () => {
        for (const key of ['../x', 'a/../../b', '/abs', '', 'a/./b']) expect(() => layout.locate(COMPANY, key)).toThrow(expect.objectContaining({ code: 'invalid_key' }));
        for (const owner of ['', '..', 'a/b', 'x y', undefined]) expect(() => layout.locate(owner, KEY)).toThrow(expect.objectContaining({ code: 'invalid_owner' }));
    });

    it('encodes the copy source, which S3 reads as a url path', () => {
        expect(layout.copySource(layout.locate(COMPANY, 'a b/ü#1.png'))).toBe(`${bucket}/ins_01jd3k8w/${COMPANY}/a%20b/%C3%BC%231.png`);
    });

    it('never makes up a public bucket url: the CDN address when set, otherwise the path under the prefix', () => {
        expect(layout.publicUrl('public_assets/email_folder_icon.png'))
            .toBe(`https://s3.ap-southeast-1.wasabisys.com/${bucket}/ins_01jd3k8w/public/public_assets/email_folder_icon.png`);
        const cdn = layoutOf(resolveS3Config({ ...HOSTED_ENV, S3_PUBLIC_BASE_URL: 'https://files.example.com/ins_01jd3k8w/public/' }));
        expect(cdn.publicUrl('public_assets/email_folder_icon.png')).toBe('https://files.example.com/ins_01jd3k8w/public/public_assets/email_folder_icon.png');
    });

    it('works with an empty prefix, for a customer with a bucket of its own', () => {
        const own = layoutOf(resolveS3Config({ S3_BUCKET: 'acme-only' }));
        expect(own.locate(COMPANY, KEY)).toEqual({ Bucket: 'acme-only', Key: `${COMPANY}/${KEY}` });
        expect(own.locate(PUBLIC_OWNER, 'a.png')).toEqual({ Bucket: 'acme-only', Key: 'public/a.png' });
    });
});
