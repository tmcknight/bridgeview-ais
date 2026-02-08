# Security Documentation

## Overview

This document describes the security measures implemented in the BridgeView AIS WebSocket proxy to protect against API key abuse, denial of service attacks, and unauthorized access.

## Security Features

### 1. Subscription Validation

The server validates all subscription requests before forwarding them to AISStream.io.

**Protections:**

- Validates that `BoundingBoxes` is an array with proper structure
- Ensures coordinates are within valid geographic bounds (-90 to 90 lat, -180 to 180 lon)
- Limits bounding box area to prevent excessive data requests (max 100 square degrees)
- Limits the number of bounding boxes per subscription (max 5)
- Validates message type filters (only allows position reports and ship static data)
- Strips any unexpected fields from subscription objects to prevent injection attacks

**Why it matters:**
Without validation, malicious clients could request global AIS data streams, exhausting your API quota and potentially incurring costs.

### 2. Rate Limiting

Multiple rate limiting mechanisms protect against abuse:

#### Connection Rate Limiting (Per IP)

- **Limit:** 5 concurrent connections per IP address
- **Scope:** Prevents a single client from monopolizing server resources
- **Configuration:** `RATE_LIMITS.MAX_CONNECTIONS_PER_IP` in [server/server.js:16](server/server.js#L16)

#### Message Rate Limiting (Per Client)

- **Limit:** 60 messages per minute per client
- **Scope:** Prevents message spam after connection is established
- **Configuration:** `RATE_LIMITS.MAX_MESSAGES_PER_MINUTE` in [server/server.js:17](server/server.js#L17)
- **Window:** Rolling 1-minute window

#### Subscription Timeout

- **Limit:** Clients must send a valid subscription within 10 seconds of connecting
- **Scope:** Prevents idle connections from consuming resources
- **Configuration:** `RATE_LIMITS.SUBSCRIPTION_TIMEOUT_MS` in [server/server.js:18](server/server.js#L18)

**Why it matters:**
Rate limiting prevents denial of service attacks and ensures fair resource allocation across legitimate clients.

### 3. Authentication (Optional)

Optional token-based authentication for production deployments.

**Configuration:**

```bash
# Server-side (.env)
WS_AUTH_TOKEN=your_secure_random_token_here

# Client-side (.env)
VITE_WS_AUTH_TOKEN=your_secure_random_token_here
```

**How it works:**

1. If `WS_AUTH_TOKEN` is set on the server, authentication is required
2. Clients must send `{ "authToken": "your_token" }` as their first message
3. Server validates the token and sends `{ "type": "authenticated" }` on success
4. Client can then send the subscription request
5. Invalid tokens result in immediate connection termination

**Why it matters:**
Authentication prevents unauthorized users from accessing your WebSocket proxy and consuming your AISStream.io API quota.

### 4. Input Sanitization

All client-provided data is sanitized before forwarding to AISStream.io.

**Sanitization process:**

1. Parse subscription JSON
2. Validate structure and values
3. Create a new sanitized object with only allowed fields:
   - `BoundingBoxes` (validated coordinates)
   - `FilterMessageTypes` (validated types)
4. Inject the API key server-side
5. Forward only the sanitized subscription

**Why it matters:**
Prevents clients from injecting malicious fields or attempting to override server-set parameters like the API key.

## Configuration Guide

### Development Setup (No Authentication)

For local development, authentication is typically disabled:

```bash
# .env
AISSTREAM_API_KEY=your_aisstream_api_key_here
PORT=3001
VITE_WS_PROXY_URL=ws://localhost:3001
# WS_AUTH_TOKEN and VITE_WS_AUTH_TOKEN left empty
```

The server will log:

```
[proxy] Warning: No authentication configured (set WS_AUTH_TOKEN for production)
```

### Production Setup (With Authentication)

For production deployments, enable authentication:

```bash
# Generate a secure random token (example)
openssl rand -base64 32

# Server .env
AISSTREAM_API_KEY=your_aisstream_api_key_here
PORT=3001
WS_AUTH_TOKEN=AbCdEfGh12345678/SecureRandomToken==

# Client .env
VITE_WS_PROXY_URL=wss://your-domain.com
VITE_WS_AUTH_TOKEN=AbCdEfGh12345678/SecureRandomToken==
```

The server will log:

```
[proxy] Authentication enabled
```

### Adjusting Rate Limits

Edit [server/server.js:14-19](server/server.js#L14-L19) to adjust limits:

```javascript
const RATE_LIMITS = {
  MAX_CONNECTIONS_PER_IP: 5, // Concurrent connections per IP
  MAX_MESSAGES_PER_MINUTE: 60, // Messages per client per minute
  SUBSCRIPTION_TIMEOUT_MS: 10000, // Time to send subscription (ms)
}
```

### Adjusting Validation Bounds

Edit [server/server.js:22-27](server/server.js#L22-L27) to adjust geographic limits:

```javascript
const VALID_BOUNDS = {
  LAT_MIN: -90,
  LAT_MAX: 90,
  LON_MIN: -180,
  LON_MAX: 180,
  MAX_BOUNDING_BOX_AREA: 100, // Square degrees
}
```

## Threat Model

### Threats Mitigated

| Threat                               | Mitigation                             | Severity   |
| ------------------------------------ | -------------------------------------- | ---------- |
| API quota exhaustion                 | Subscription validation, rate limiting | **High**   |
| Denial of service (connection flood) | IP-based connection limits             | **High**   |
| Denial of service (message spam)     | Per-client message rate limiting       | **Medium** |
| Unauthorized access                  | Optional token authentication          | **Medium** |
| Parameter injection                  | Input sanitization, field whitelisting | **Medium** |
| Idle connection abuse                | Subscription timeout                   | **Low**    |

### Threats NOT Mitigated

These threats are out of scope for the current implementation:

- **DDoS attacks**: Large-scale distributed attacks require infrastructure-level protection (CDN, load balancer, etc.)
- **Token theft**: If `WS_AUTH_TOKEN` is compromised, implement token rotation and secure storage
- **Man-in-the-middle attacks**: Use TLS/WSS in production (handled at infrastructure level)
- **Advanced rate limit bypass**: Sophisticated attackers with many IPs may bypass IP-based limits

## Security Best Practices

### For Developers

1. **Never commit `.env` files** - These contain sensitive API keys and tokens
2. **Use WSS (WebSocket Secure) in production** - Encrypt all WebSocket traffic
3. **Rotate authentication tokens periodically** - Especially if tokens are exposed
4. **Monitor connection patterns** - Watch for unusual spikes in connections or messages
5. **Keep dependencies updated** - Regularly update `ws` and other packages for security patches

### For Deployment

1. **Enable authentication** - Always use `WS_AUTH_TOKEN` in production
2. **Use environment variables** - Never hardcode secrets in code
3. **Implement logging and monitoring** - Track failed authentication attempts and rate limit violations
4. **Use a reverse proxy** - Consider nginx or similar for additional security layers
5. **Set up alerts** - Monitor for excessive connection attempts or API quota usage

### For Auditing

Look for these log patterns:

```bash
# Rate limit violations
grep "rate limit exceeded" server.log

# Authentication failures
grep "failed authentication" server.log

# Invalid subscriptions
grep "invalid subscription" server.log

# Connection patterns
grep "client connected" server.log | wc -l
```

## Testing Security

### Test Rate Limiting

```javascript
// Test connection limit
for (let i = 0; i < 10; i++) {
  const ws = new WebSocket("ws://localhost:3001")
  // After 5 connections, subsequent ones should be rejected
}

// Test message rate limit
const ws = new WebSocket("ws://localhost:3001")
ws.onopen = () => {
  // Send 100 messages rapidly
  for (let i = 0; i < 100; i++) {
    ws.send(JSON.stringify({ test: i }))
  }
  // After 60 messages in one minute, connection should close
}
```

### Test Validation

```javascript
// Test invalid bounding box
const ws = new WebSocket("ws://localhost:3001")
ws.onopen = () => {
  ws.send(
    JSON.stringify({
      BoundingBoxes: [
        [
          [0, 0],
          [200, 200],
        ], // Invalid: latitude > 90
      ],
    }),
  )
  // Should close with error message
}

// Test oversized bounding box
ws.send(
  JSON.stringify({
    BoundingBoxes: [
      [
        [0, 0],
        [50, 50],
      ], // 2500 square degrees (too large)
    ],
  }),
)
// Should be rejected
```

### Test Authentication

```javascript
// Test without token (when required)
const ws = new WebSocket("ws://localhost:3001")
ws.onopen = () => {
  ws.send(
    JSON.stringify({
      BoundingBoxes: [
        [
          [42, -83],
          [43, -82],
        ],
      ],
    }),
  )
  // Should fail if WS_AUTH_TOKEN is set
}

// Test with valid token
ws.onopen = () => {
  ws.send(
    JSON.stringify({
      authToken: "your_token_here",
    }),
  )
  // Should receive { type: "authenticated" }
}
```

## Incident Response

If you suspect abuse or security issues:

1. **Immediately rotate tokens** - Generate new `WS_AUTH_TOKEN` and redeploy
2. **Check logs** - Look for suspicious patterns in connection attempts
3. **Review API usage** - Check AISStream.io dashboard for unusual quota consumption
4. **Adjust rate limits** - Temporarily tighten limits if under attack
5. **Block IPs if necessary** - Add firewall rules for persistent attackers

## Future Enhancements

Potential security improvements for future versions:

- [ ] JWT-based authentication with expiration
- [ ] Per-user API key management
- [ ] Geographic IP filtering (only allow connections from certain regions)
- [ ] Advanced rate limiting with token bucket algorithm
- [ ] Integration with cloud-based DDoS protection
- [ ] Connection fingerprinting to detect automated abuse
- [ ] Webhook notifications for security events

## Questions and Support

For security questions or to report vulnerabilities, please:

1. Check this documentation first
2. Review the code in [server/server.js](server/server.js)
3. Open an issue on GitHub (for non-sensitive questions)
4. For sensitive security issues, contact the maintainers directly

## References

- [AISStream.io API Documentation](https://aisstream.io/documentation)
- [WebSocket Security Best Practices](https://www.rfc-editor.org/rfc/rfc6455.html)
- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [Rate Limiting Patterns](https://cloud.google.com/architecture/rate-limiting-strategies-techniques)
