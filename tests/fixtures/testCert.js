const forge = require('node-forge');

/* A throwaway self-signed certificate for local https servers that stand in for a declared host. */
const testCert = (hostnames) => {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = `01${forge.util.bytesToHex(forge.random.getBytesSync(8))}`;
    cert.validity.notBefore = new Date(Date.now() - 60 * 1000);
    cert.validity.notAfter = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const subject = [{ name: 'commonName', value: hostnames[0] }];
    cert.setSubject(subject);
    cert.setIssuer(subject);
    cert.setExtensions([
        { name: 'basicConstraints', cA: true },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyCertSign: true },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames: hostnames.map((value) => ({ type: 2, value })) },
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) };
};

module.exports = { testCert };
