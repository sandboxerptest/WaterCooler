const crypto = require('crypto');

// Custom Exceptions
class MettaraError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MettaraError';
  }
}

class BadRequestError extends MettaraError {
  constructor(message) {
    super(message);
    this.name = 'BadRequestError';
  }
}

class SignatureError extends MettaraError {
  constructor(message) {
    super(message);
    this.name = 'SignatureError';
  }
}

class ReplayError extends SignatureError {
  constructor(message) {
    super(message);
    this.name = 'ReplayError';
  }
}

class ToolNotFoundError extends MettaraError {
  constructor(message) {
    super(message);
    this.name = 'ToolNotFoundError';
  }
}

class ToolExecutionError extends MettaraError {
  constructor(message) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

// Default Configuration
const defaultSignatureConfig = {
  required: true,
  skewSeconds: 300,
  nonceTtlSeconds: 300,
  signatureHeader: 'x-mettara-signature',
  timestampHeader: 'x-mettara-timestamp',
  nonceHeader: 'x-mettara-nonce',
  contentHashHeader: 'x-mettara-content-sha256',
};

// In-Memory Nonce Store
class InMemoryNonceStore {
  constructor() {
    this.cache = new Map();
  }

  isReplay(nonce, timestamp, now, ttlSeconds) {
    // Remove expired entries
    for (const [key, expiry] of this.cache.entries()) {
      if (expiry <= now) {
        this.cache.delete(key);
      }
    }

    const replayKey = `${nonce}:${timestamp}`;
    if (this.cache.has(replayKey)) {
      return true;
    }

    this.cache.set(replayKey, now + ttlSeconds);
    return false;
  }
}

// Signature Verifier
class SignatureVerifier {
  constructor(secretProvider, config = {}, nonceStore = null) {
    this.secretProvider = secretProvider;
    this.config = { ...defaultSignatureConfig, ...config };
    this.nonceStore = nonceStore || new InMemoryNonceStore();
  }

  async verify(headers, method, pathWithQuery, body) {
    if (!this.config.required) {
      return;
    }

    const normalizedHeaders = this._normalizeHeaders(headers);
    const signature = normalizedHeaders[this.config.signatureHeader];
    const timestamp = normalizedHeaders[this.config.timestampHeader];
    const nonce = normalizedHeaders[this.config.nonceHeader];

    if (!signature || !timestamp || !nonce) {
      throw new SignatureError('Missing signature headers');
    }

    const now = Math.floor(Date.now() / 1000);
    const timestampValue = parseInt(timestamp, 10);

    if (isNaN(timestampValue)) {
      throw new SignatureError('Invalid signature timestamp');
    }

    if (Math.abs(now - timestampValue) > this.config.skewSeconds) {
      throw new SignatureError('Signature timestamp out of range');
    }

    const isReplay = this.nonceStore.isReplay(nonce, timestamp, now, this.config.nonceTtlSeconds);
    if ((isReplay instanceof Promise ? await isReplay : isReplay)) {
      throw new ReplayError('Signature replay detected');
    }

    const contentHash = this._computeContentHash(body);
    const suppliedHash = normalizedHeaders[this.config.contentHashHeader];

    if (suppliedHash && !this._timingSafeEqual(suppliedHash, contentHash)) {
      throw new SignatureError('Content hash mismatch');
    }

    const stringToSign = [
      method.toUpperCase(),
      pathWithQuery,
      timestamp,
      nonce,
      contentHash,
    ].join('\n');

    const secret = this.secretProvider();
    const expected = this._computeSignature(secret, stringToSign);

    if (!this._timingSafeEqual(signature, expected)) {
      throw new SignatureError('Invalid signature');
    }
  }

  _normalizeHeaders(headers) {
    const normalized = {};
    for (const [key, value] of Object.entries(headers)) {
      const normalizedKey = key.toLowerCase();
      normalized[normalizedKey] = Array.isArray(value) ? value[0] : value;
    }
    return normalized;
  }

  _computeContentHash(body) {
    return crypto.createHash('sha256').update(body).digest('base64');
  }

  _computeSignature(secret, stringToSign) {
    return crypto
      .createHmac('sha256', secret)
      .update(stringToSign)
      .digest('base64');
  }

  _timingSafeEqual(a, b) {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  }
}

// Request Parser
class RequestParser {
  parse(body) {
    let payload;

    if (!body || body.length === 0) {
      payload = {};
    } else {
      const raw = typeof body === 'string' ? body : body.toString('utf-8');
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new BadRequestError('Request body must be a JSON object');
        }
        payload = parsed;
      } catch (error) {
        if (error instanceof BadRequestError) {
          throw error;
        }
        throw new BadRequestError('Request body must be valid JSON');
      }
    }

    const name = payload.name;
    if (typeof name !== 'string' || !name.trim()) {
      throw new BadRequestError('Missing tool name');
    }

    const args = payload.arguments || {};
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      throw new BadRequestError('arguments must be an object');
    }

    return {
      name,
      arguments: args,
      raw: payload,
    };
  }
}

// Tool Registry
class ToolRegistry {
  constructor() {
    this.handlers = new Map();
  }

  register(name, handler, aliases = null) {
    this.handlers.set(name, handler);
    if (aliases) {
      for (const alias of aliases) {
        this.handlers.set(alias, handler);
      }
    }
  }

  async dispatch(request, context = null) {
    const handler = this.handlers.get(request.name);
    if (!handler) {
      throw new ToolNotFoundError(`Unknown tool '${request.name}'`);
    }

    try {
      const result = handler(request, context);
      if (result instanceof Promise) {
        return await result;
      }
      return result;
    } catch (error) {
      if (error instanceof MettaraError) {
        throw error;
      }
      throw new ToolExecutionError('Tool execution failed');
    }
  }
}

// Mettara Processor
class MettaraProcessor {
  constructor(verifier, parser, registry) {
    this.verifier = verifier;
    this.parser = parser;
    this.registry = registry;
  }

  async handle(headers, method, pathWithQuery, body, context = null) {
    await this.verifier.verify(headers, method, pathWithQuery, body);
    const request = this.parser.parse(body);
    const data = await this.registry.dispatch(request, context);
    return { status: 'success', data };
  }
}

// Helper Functions
function envSignatureConfig() {
  const requiredValue = (process.env.METTARA_SIGNATURE_REQUIRED || 'true').trim().toLowerCase();
  const required = requiredValue !== '0' && requiredValue !== 'false' && requiredValue !== 'no';

  const skewSeconds = parseInt(process.env.METTARA_SIGNATURE_SKEW_SECONDS || '300', 10);
  const nonceTtlSeconds = parseInt(process.env.METTARA_NONCE_TTL_SECONDS || '300', 10);

  return {
    required,
    skewSeconds,
    nonceTtlSeconds,
    signatureHeader: defaultSignatureConfig.signatureHeader,
    timestampHeader: defaultSignatureConfig.timestampHeader,
    nonceHeader: defaultSignatureConfig.nonceHeader,
    contentHashHeader: defaultSignatureConfig.contentHashHeader,
  };
}

function envApiSecret(envVar = 'METTARA_API_SECRET') {
  const secret = process.env[envVar];
  if (!secret) {
    throw new SignatureError(`${envVar} is not configured`);
  }
  return secret;
}

function buildMettaraProcessor({ secretProvider, config = null, nonceStore = null }) {
  const verifier = new SignatureVerifier(secretProvider, config, nonceStore);
  const parser = new RequestParser();
  const registry = new ToolRegistry();
  const processor = new MettaraProcessor(verifier, parser, registry);

  return { processor, registry };
}

function pathWithQuery(path, query = null) {
  if (query) {
    return `${path}?${query}`;
  }
  return path;
}

function requireIntArgument(args, label, ...keys) {
  const value = firstArgument(args, ...keys);
  if (value === null || value === undefined) {
    throw new BadRequestError(`${label} is required`);
  }

  const intValue = parseInt(String(value), 10);
  if (isNaN(intValue)) {
    throw new BadRequestError(`${label} must be an integer`);
  }

  return intValue;
}

function firstArgument(args, ...keys) {
  for (const key of keys) {
    const value = args[key];
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return null;
}

function filteredArguments(args, excluded) {
  const excludedSet = new Set(excluded);
  const filtered = {};

  for (const [key, value] of Object.entries(args)) {
    if (!excludedSet.has(key) && value !== null && value !== undefined) {
      filtered[key] = value;
    }
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// MettaraClient — outbound API client for conversations, messages, and files
// ---------------------------------------------------------------------------

class ApiError extends MettaraError {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

class RateLimitError extends ApiError {
  constructor(message, status, body, retryAfter = undefined) {
    super(message, status, body);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

class AuthError extends ApiError {
  constructor(message, status, body) {
    super(message, status, body);
    this.name = 'AuthError';
  }
}

const DEFAULT_BASE_URL = 'https://api.mettara.ai';
const MAX_RETRIES = 3;

/**
 * Outbound API client for the Mettara platform.
 *
 * Takes the same raw platform API key used as `EmbedClient(secret)`.
 * Typical workflow:
 *   1. `EmbedClient.getToken(...)` → `{ userId, groupId }`
 *   2. `MettaraClient.sendMessage(conversationId, groupId, userId, content)`
 */
class MettaraClient {
  /**
   * @param {string} apiKey - Platform API key (same as EmbedClient secret)
   * @param {string} [baseUrl] - Mettara API base URL (default: https://api.mettara.ai)
   */
  constructor(apiKey, baseUrl = DEFAULT_BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  // ── AI discovery ──────────────────────────────────────────────────────────

  /**
   * @param {string} groupId
   * @returns {Promise<Array>}
   */
  async listAis(groupId) {
    const data = await this._request('GET', `/v1/ais?group_id=${encodeURIComponent(groupId)}`);
    return data.ais;
  }

  // ── Conversations ─────────────────────────────────────────────────────────

  /**
   * @param {string} groupId
   * @param {string} userId
   * @param {string} aiTechnicalName
   * @param {string} [name]
   * @returns {Promise<Object>}
   */
  async createConversation(groupId, userId, aiTechnicalName, name = undefined) {
    const payload = { group_id: groupId, user_id: userId, ai_technical_name: aiTechnicalName };
    if (name !== undefined) payload.name = name;
    return this._request('POST', '/v1/conversations', payload);
  }

  /**
   * @param {string} groupId
   * @param {string} [userId]
   * @param {number} [limit]
   * @param {string} [before]
   * @returns {Promise<Object>}
   */
  async listConversations(groupId, userId = undefined, limit = undefined, before = undefined) {
    const params = new URLSearchParams({ group_id: groupId });
    if (userId !== undefined) params.set('user_id', userId);
    if (limit !== undefined) params.set('limit', String(limit));
    if (before !== undefined) params.set('before', before);
    return this._request('GET', `/v1/conversations?${params}`);
  }

  /**
   * @param {string} conversationId
   * @param {string} groupId
   * @returns {Promise<Object>}
   */
  async getConversation(conversationId, groupId) {
    return this._request(
      'GET',
      `/v1/conversations/${encodeURIComponent(conversationId)}?group_id=${encodeURIComponent(groupId)}`
    );
  }

  /**
   * @param {string} conversationId
   * @param {string} groupId
   * @returns {Promise<void>}
   */
  async deleteConversation(conversationId, groupId) {
    await this._request(
      'DELETE',
      `/v1/conversations/${encodeURIComponent(conversationId)}?group_id=${encodeURIComponent(groupId)}`
    );
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  /**
   * @param {string} conversationId
   * @param {string} groupId
   * @param {number} [limit]
   * @param {string} [before]
   * @returns {Promise<Object>}
   */
  async listMessages(conversationId, groupId, limit = undefined, before = undefined) {
    const params = new URLSearchParams({ group_id: groupId });
    if (limit !== undefined) params.set('limit', String(limit));
    if (before !== undefined) params.set('before', before);
    return this._request(
      'GET',
      `/v1/conversations/${encodeURIComponent(conversationId)}/messages?${params}`
    );
  }

  /**
   * Send a message and wait for the AI reply (non-streaming).
   * @param {string} conversationId
   * @param {string} groupId
   * @param {string} userId
   * @param {string} content
   * @param {string[]} [fileIds]
   * @returns {Promise<Object>}
   */
  async sendMessage(conversationId, groupId, userId, content, fileIds = undefined) {
    const payload = { group_id: groupId, user_id: userId, content, stream: false };
    if (fileIds && fileIds.length > 0) payload.file_ids = fileIds;
    return this._request(
      'POST',
      `/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
      payload
    );
  }

  /**
   * Stream an AI response as SSE deltas.
   * Yields `{ content }` objects for each `chat.delta` event.
   * @param {string} conversationId
   * @param {string} groupId
   * @param {string} userId
   * @param {string} content
   * @param {string[]} [fileIds]
   * @returns {AsyncIterable<{content: string}>}
   */
  async *streamMessage(conversationId, groupId, userId, content, fileIds = undefined) {
    const url = `${this.baseUrl}/v1/conversations/${encodeURIComponent(conversationId)}/messages`;
    const bodyPayload = { group_id: groupId, user_id: userId, content, stream: true };
    if (fileIds && fileIds.length > 0) bodyPayload.file_ids = fileIds;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(bodyPayload),
    });

    if (!response.ok) {
      await this._throwForStatus(response);
    }

    if (!response.body) {
      throw new MettaraError('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data:')) {
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') return;
            try {
              const event = JSON.parse(payload);
              if (event.object === 'error') {
                throw new MettaraError(`SSE error: ${event.message ?? 'unknown'}`);
              }
              if (event.object === 'chat.activity' && event.content) {
                yield { content: event.content, type: 'activity' };
              } else if (event.object === 'chat.reasoning' && event.content) {
                yield { content: event.content, type: 'reasoning' };
              } else if (event.object === 'chat.delta' && event.delta?.content) {
                yield { content: event.delta.content, type: 'content' };
              }
            } catch (err) {
              if (err instanceof MettaraError) throw err;
              // ignore unparseable lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── Files ─────────────────────────────────────────────────────────────────

  /**
   * @param {string} groupId
   * @param {Uint8Array} file
   * @param {string} filename
   * @returns {Promise<Object>}
   */
  async uploadFile(groupId, file, filename) {
    const form = new FormData();
    form.append('group_id', groupId);
    form.append('file', new Blob([file]), filename);
    return this._requestRaw('POST', '/v1/files', form);
  }

  /**
   * @param {string} groupId
   * @param {number} [limit]
   * @returns {Promise<Object>}
   */
  async listFiles(groupId, limit = undefined) {
    const params = new URLSearchParams({ group_id: groupId });
    if (limit !== undefined) params.set('limit', String(limit));
    return this._request('GET', `/v1/files?${params}`);
  }

  /**
   * @param {string} fileId
   * @param {string} groupId
   * @returns {Promise<Buffer>}
   */
  async getFile(fileId, groupId) {
    const response = await this._fetchWithRetry(
      `/v1/files/${encodeURIComponent(fileId)}/content?group_id=${encodeURIComponent(groupId)}`,
      { method: 'GET' }
    );
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  }

  /**
   * @param {string} fileId
   * @param {string} groupId
   * @returns {Promise<void>}
   */
  async deleteFile(fileId, groupId) {
    await this._request(
      'DELETE',
      `/v1/files/${encodeURIComponent(fileId)}?group_id=${encodeURIComponent(groupId)}`
    );
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  async _request(method, path, payload = undefined) {
    const options = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };
    if (payload !== undefined) {
      options.body = JSON.stringify(payload);
    }
    const response = await this._fetchWithRetry(path, options);
    return response.json();
  }

  async _requestRaw(method, path, body) {
    const options = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
      body,
    };
    const response = await this._fetchWithRetry(path, options);
    return response.json();
  }

  async _fetchWithRetry(path, options) {
    const url = `${this.baseUrl}${path}`;
    let attempt = 0;

    while (true) {
      const response = await fetch(url, options);

      if (response.ok) return response;

      // Don't retry 4xx except 429
      if (response.status !== 429 && response.status < 500) {
        await this._throwForStatus(response);
      }

      attempt++;
      if (attempt >= MAX_RETRIES) {
        await this._throwForStatus(response);
      }

      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterSec = retryAfterHeader ? parseFloat(retryAfterHeader) : null;
      const delayMs = retryAfterSec !== null
        ? retryAfterSec * 1000
        : Math.min(1000 * Math.pow(2, attempt - 1), 16000);

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  async _throwForStatus(response) {
    let body = null;
    try {
      body = await response.json();
    } catch {
      // ignore
    }
    const message = `HTTP ${response.status}`;
    if (response.status === 401) throw new AuthError(message, response.status, body);
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfter = retryAfterHeader ? parseFloat(retryAfterHeader) : undefined;
      throw new RateLimitError(message, response.status, body, retryAfter);
    }
    throw new ApiError(message, response.status, body);
  }
}

// ---------------------------------------------------------------------------
// Embed Client — outbound JIT user provisioning
// ---------------------------------------------------------------------------

class EmbedError extends MettaraError {
  constructor(message, statusCode = null) {
    super(message);
    this.name = 'EmbedError';
    this.statusCode = statusCode;
  }
}

class EmbedClient {
  /**
   * Signs and sends embed token requests to the Mettara API.
   *
   * Handles JIT user provisioning: on first call for a given user Mettara
   * creates the user and group automatically, preserving sourceUserId and
   * sourceGroupId as external identifiers.
   *
   * @param {string} secret - Platform API secret for HMAC signing
   * @param {string} baseUrl - Mettara API base URL (e.g. https://api.mettara.ai)
   * @param {string} platformId - Your platform UUID
   */
  constructor(secret, baseUrl, platformId) {
    this.secret = secret;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.platformId = platformId;
  }

  /**
   * Exchange credentials for an embed JWT, provisioning the user if needed.
   * @returns {Promise<{accessToken: string, expiresAt: number, userId: string, groupId: string, platformId: string}>}
   */
  async getToken(sourceUserId, sourceGroupId, sourceGroupName, name, email) {
    const params = {
      platform_id: this.platformId,
      source_user_id: sourceUserId,
      source_group_id: sourceGroupId,
      source_group_name: sourceGroupName,
      name,
      email: email.trim().toLowerCase(),
      t: this._currentTimestamp(),
    };
    params.sig = this._sign(params);
    return this._post('/embed/token', params);
  }

  /**
   * Refresh an existing embed JWT without re-provisioning.
   * @returns {Promise<{accessToken: string, expiresAt: number, userId: string, groupId: string, platformId: string}>}
   */
  async refreshToken(sourceUserId, sourceGroupId) {
    const params = {
      platform_id: this.platformId,
      source_user_id: sourceUserId,
      source_group_id: sourceGroupId,
      t: this._currentTimestamp(),
    };
    params.sig = this._sign(params);
    return this._post('/embed/refresh', params);
  }

  _sign(params) {
    const parts = Object.keys(params)
      .sort()
      .map(key => `${this._rfc3986Encode(key)}=${this._rfc3986Encode(String(params[key]))}`);
    const canonical = parts.join('&');
    return crypto.createHmac('sha256', this.secret).update(canonical).digest('hex');
  }

  _rfc3986Encode(str) {
    return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  }

  _currentTimestamp() {
    return new Date().toISOString();
  }

  async _post(path, payload) {
    const url = `${this.baseUrl}${path}`;
    const body = JSON.stringify(payload);

    let raw;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!response.ok) {
        throw new EmbedError(`Embed token request failed: HTTP ${response.status}`, response.status);
      }
      raw = await response.json();
    } catch (err) {
      if (err instanceof EmbedError) throw err;
      throw new EmbedError(`Embed token request failed: ${err.message}`);
    }

    const result = raw.result || {};
    if (!result.access_token) {
      throw new EmbedError('Unexpected response from Mettara');
    }
    return {
      accessToken: result.access_token,
      expiresAt: result.expires_at,
      userId: result.user_id,
      groupId: result.group_id,
      platformId: result.platform_id,
    };
  }
}

// Exports
module.exports = {
  // Exceptions
  MettaraError,
  BadRequestError,
  SignatureError,
  ReplayError,
  ToolNotFoundError,
  ToolExecutionError,

  // Classes
  InMemoryNonceStore,
  SignatureVerifier,
  RequestParser,
  ToolRegistry,
  MettaraProcessor,

  // Configuration
  defaultSignatureConfig,

  // Helper Functions
  envSignatureConfig,
  envApiSecret,
  buildMettaraProcessor,
  pathWithQuery,
  requireIntArgument,
  firstArgument,
  filteredArguments,

  // Embed Client
  EmbedError,
  EmbedClient,

  // Mettara Client
  ApiError,
  RateLimitError,
  AuthError,
  MettaraClient,
};
