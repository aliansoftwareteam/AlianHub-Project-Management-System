const logger = require('../../Config/loggerConfig');

/**
 * ICE configuration for the browser's RTCPeerConnection (AHE-3839).
 *
 * WebRTC needs to find a path between two browsers that are usually both behind NAT.
 * STUN lets each side discover its own public address, which is enough for most home and
 * office networks. TURN relays the media when it is not — symmetric NAT and restrictive
 * corporate firewalls, which is roughly 15-20% of real-world connections.
 *
 * Both are read from the environment rather than hardcoded, because this product is
 * self-hosted: an operator has to be able to point at their own relay, and a deployment
 * that handles company traffic should not be sending anything to a public STUN server.
 *
 * TURN CREDENTIALS ARE NOT SENT AS-IS. A long-lived TURN username and password handed to
 * the browser is a relay anyone can borrow — it is readable in devtools and works from
 * anywhere until the day it is rotated. Instead this mints the short-lived HMAC
 * credential coturn supports (`use-auth-secret` / REST API), so what reaches the client
 * expires within the hour and the shared secret never leaves the server.
 */

const DEFAULT_TTL_SECONDS = 3600;

/** coturn's REST scheme: username is "<expiry-unix>:<user>", password is its HMAC-SHA1. */
const buildTurnCredential = (secret, userId, ttlSeconds) => {
    const crypto = require('crypto');
    const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
    const username = `${expiry}:${userId || 'anon'}`;
    const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
    return { username, credential };
};

/**
 * Build the iceServers array. Exported separately so it can be unit-tested without
 * standing up Express.
 */
const buildIceServers = (env, userId) => {
    const servers = [];

    const stun = String(env.STUN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (stun.length) servers.push({ urls: stun });

    const turnUrls = String(env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (turnUrls.length) {
        const secret = String(env.TURN_STATIC_AUTH_SECRET || '').trim();
        const ttl = Number(env.TURN_CREDENTIAL_TTL_SECONDS) > 0
            ? Number(env.TURN_CREDENTIAL_TTL_SECONDS) : DEFAULT_TTL_SECONDS;

        if (secret) {
            const { username, credential } = buildTurnCredential(secret, userId, ttl);
            servers.push({ urls: turnUrls, username, credential });
        } else if (env.TURN_USERNAME && env.TURN_PASSWORD) {
            // Static credentials. Supported because some managed TURN providers only
            // offer this, but it is the weaker option — the credential is long-lived and
            // visible to anyone who opens devtools.
            servers.push({ urls: turnUrls, username: String(env.TURN_USERNAME), credential: String(env.TURN_PASSWORD) });
        } else {
            logger.warn('TURN_URLS is set but no credentials are configured — TURN will be ignored. Set TURN_STATIC_AUTH_SECRET (preferred) or TURN_USERNAME/TURN_PASSWORD.');
        }
    }

    return servers;
};

/* GET /api/v2/calls/ice-config */
exports.getIceConfig = (req, res) => {
    try {
        const iceServers = buildIceServers(process.env, req.uid);
        return res.status(200).json({
            status: true,
            data: {
                iceServers,
                // The client shows a plain warning when there is no relay: without TURN a
                // minority of calls will fail to connect for reasons the user cannot see
                // or fix, and a silent failure is the worst possible version of that.
                hasTurn: iceServers.some((s) => String(s.urls).includes('turn')),
                ttlSeconds: Number(process.env.TURN_CREDENTIAL_TTL_SECONDS) > 0
                    ? Number(process.env.TURN_CREDENTIAL_TTL_SECONDS) : DEFAULT_TTL_SECONDS,
            },
        });
    } catch (error) {
        logger.error(`getIceConfig error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({ status: false, statusText: 'Could not build the ICE configuration.' });
    }
};

exports.buildIceServers = buildIceServers;
exports.buildTurnCredential = buildTurnCredential;
