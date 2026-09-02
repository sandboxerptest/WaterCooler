import * as crypto from 'crypto';

// Custom Exceptions
export class MettaraError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'MettaraError';
    Object.setPrototypeOf(this, MettaraError.prototype);
  }
}

export class BadRequestError extends MettaraError {
  constructor(message?: string) {
    super(message);
    this.name = 'BadRequestError';
    Object.setPrototypeOf(this, BadRequestError.prototype);
  }
}

export class SignatureError extends MettaraError {
  constructor(message?: string) {
    super(message);
    this.name = 'SignatureError';
    Object.setPrototypeOf(this, SignatureError.prototype);
  }
}

export class ReplayError extends SignatureError {
  constructor(message?: string) {
    super(message);
    this.name = 'ReplayError';
    Object.setPrototypeOf(this, ReplayError.prototype);
  }
}

export class ToolNotFoundError extends MettaraError {
  constructor(message?: string) {
    super(message);
    this.name = 'ToolNotFoundError';
    Object.setPrototypeOf(this, ToolNotFoundError.prototype);
  }
}

export class ToolExecutionError extends MettaraError {
  constructor(message?: string) {
    super(message);
    this.name = 'ToolExecutionError';
    Object.setPrototypeOf(this, ToolExecutionError.prototype);
  }
}

// Data Interfaces
export interface ToolRequest {
  name: string;
  arguments: Record<string, any>;
  raw: Record<string, any>;
}

export interface SignatureConfig {
  required: boolean;
  skewSeconds: number;
  nonceTtlSeconds: number;
  signatureHeader: string;
  timestampHeader: string;
  nonceHeader: string;
  contentHashHeader: string;
}

export const defaultSignatureConfig: SignatureConfig = {
  required: true,
  skewSeconds: 300,
  nonceTtlSeconds: 300,
  signatureHeader: 'x-mettara-signature',
  timestampHeader: 'x-mettara-timestamp',
  nonceHeader: 'x-mettara-nonce',
  contentHashHeader: 'x-mettara-content-sha256',
};

// Nonce Store Interface
export interface NonceStore {
  isReplay(nonce: string, timestamp: string, now: number, ttlSeconds: number): boolean;
}

// In-Memory Nonce Store
export class InMemoryNonceStore implements NonceStore {
  private cache: Map<string, number> = new Map();

  isReplay(nonce: string, timestamp: string, now: number, ttlSeconds: number): boolean {
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
export class SignatureVerifier {
  private secretProvider: () => string;
  private config: SignatureConfig;
  private nonceStore: NonceStore;

  constructor(
    secretProvider: () => string,
    config?: Partial<SignatureConfig>,
    nonceStore?: NonceStore
  ) {
    this.secretProvider = secretProvider;
    this.config = { ...defaultSignatureConfig, ...config };
    this.nonceStore = nonceStore || new InMemoryNonceStore();
  }

  verify(
    headers: Record<string, string | string[]>,
    method: string,
    pathWithQuery: string,
    body: Buffer
  ): void {
    if (!this.config.required) {
      return;
    }

    const normalizedHeaders = this.normalizeHeaders(headers);
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

    if (this.nonceStore.isReplay(nonce, timestamp, now, this.config.nonceTtlSeconds)) {
      throw new ReplayError('Signature replay detected');
    }

    const contentHash = this.computeContentHash(body);
    const suppliedHash = normalizedHeaders[this.config.contentHashHeader];

    if (suppliedHash && !this.timingSafeEqual(suppliedHash, contentHash)) {
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
    const expected = this.computeSignature(secret, stringToSign);

    if (!this.timingSafeEqual(signature, expected)) {
      throw new SignatureError('Invalid signature');
    }
  }

  private normalizeHeaders(headers: Record<string, string | string[]>): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      const normalizedKey = key.toLowerCase();
      normalized[normalizedKey] = Array.isArray(value) ? value[0] : value;
    }
    return normalized;
  }

  private computeContentHash(body: Buffer): string {
    return crypto.createHash('sha256').update(body).digest('base64');
  }

  private computeSignature(secret: string, stringToSign: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(stringToSign)
      .digest('base64');
  }

  private timingSafeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  }
}

// Request Parser
export class RequestParser {
  parse(body: Buffer | string | null): ToolRequest {
    let payload: Record<string, any>;

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

// Tool Handler Type
export type ToolHandler = (
  request: ToolRequest,
  context?: Record<string, any>
) => any | Promise<any>;

// Tool Registry
export class ToolRegistry {
  private handlers: Map<string, ToolHandler> = new Map();

  register(name: string, handler: ToolHandler, aliases?: string[]): void {
    this.handlers.set(name, handler);
    if (aliases) {
      for (const alias of aliases) {
        this.handlers.set(alias, handler);
      }
    }
  }

  async dispatch(request: ToolRequest, context?: Record<string, any>): Promise<any> {
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
export class MettaraProcessor {
  constructor(
    private verifier: SignatureVerifier,
    private parser: RequestParser,
    private registry: ToolRegistry
  ) {}

  async handle(
    headers: Record<string, string | string[]>,
    method: string,
    pathWithQuery: string,
    body: Buffer,
    context?: Record<string, any>
  ): Promise<{ status: string; data: any }> {
    this.verifier.verify(headers, method, pathWithQuery, body);
    const request = this.parser.parse(body);
    const data = await this.registry.dispatch(request, context);
    return { status: 'success', data };
  }
}

// Helper Functions
export function envSignatureConfig(): SignatureConfig {
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

export function envApiSecret(envVar: string = 'METTARA_API_SECRET'): string {
  const secret = process.env[envVar];
  if (!secret) {
    throw new SignatureError(`${envVar} is not configured`);
  }
  return secret;
}

export function buildMettaraProcessor(options: {
  secretProvider: () => string;
  config?: Partial<SignatureConfig>;
  nonceStore?: NonceStore;
}): { processor: MettaraProcessor; registry: ToolRegistry } {
  const verifier = new SignatureVerifier(
    options.secretProvider,
    options.config,
    options.nonceStore
  );
  const parser = new RequestParser();
  const registry = new ToolRegistry();
  const processor = new MettaraProcessor(verifier, parser, registry);

  return { processor, registry };
}

export function pathWithQuery(path: string, query?: string | null): string {
  if (query) {
    return `${path}?${query}`;
  }
  return path;
}

export function requireIntArgument(
  args: Record<string, any>,
  label: string,
  ...keys: string[]
): number {
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

export function firstArgument(
  args: Record<string, any>,
  ...keys: string[]
): any | null {
  for (const key of keys) {
    const value = args[key];
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return null;
}

export function filteredArguments(
  args: Record<string, any>,
  excluded: string[]
): Record<string, any> {
  const excludedSet = new Set(excluded);
  const filtered: Record<string, any> = {};

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

// Types

export interface Ai {
  id: string;
  technical_name: string;
  display_name: string;
  description?: string;
  profile_picture?: string;
}

export interface Conversation {
  id: string;
  object: string;
  group_id: string;
  user_id: string;
  ai: Ai;
  created_at: string;
}

export interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
  file_ids?: string[];
}

export interface Delta {
  content: string;
  type: 'content' | 'activity' | 'reasoning';
}

export interface MFile {
  id: string;
  object: string;
  filename: string;
  size: number;
  created_at: string;
  group_id: string;
}

export interface Page<T> {
  object: string;
  data: T[];
  has_more: boolean;
  first_id?: string;
  last_id?: string;
}

// Error hierarchy

export class ApiError extends MettaraError {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export class RateLimitError extends ApiError {
  retryAfter?: number;
  constructor(message: string, status: number, body: unknown, retryAfter?: number) {
    super(message, status, body);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class AuthError extends ApiError {
  constructor(message: string, status: number, body: unknown) {
    super(message, status, body);
    this.name = 'AuthError';
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

// MettaraClient

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
export class MettaraClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl: string = DEFAULT_BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  // ── AI discovery ──────────────────────────────────────────────────────────

  async listAis(groupId: string): Promise<Ai[]> {
    const data = await this._request<{ ais: Ai[] }>('GET', `/v1/ais?group_id=${encodeURIComponent(groupId)}`);
    return data.ais;
  }

  // ── Conversations ─────────────────────────────────────────────────────────

  async createConversation(
    groupId: string,
    userId: string,
    aiTechnicalName: string,
    name?: string
  ): Promise<Conversation> {
    return this._request<Conversation>('POST', '/v1/conversations', {
      group_id: groupId,
      user_id: userId,
      ai_technical_name: aiTechnicalName,
      ...(name !== undefined ? { name } : {}),
    });
  }

  async listConversations(
    groupId: string,
    userId?: string,
    limit?: number,
    before?: string
  ): Promise<Page<Conversation>> {
    const params = new URLSearchParams({ group_id: groupId });
    if (userId !== undefined) params.set('user_id', userId);
    if (limit !== undefined) params.set('limit', String(limit));
    if (before !== undefined) params.set('before', before);
    return this._request<Page<Conversation>>('GET', `/v1/conversations?${params}`);
  }

  async getConversation(conversationId: string, groupId: string): Promise<Conversation> {
    return this._request<Conversation>(
      'GET',
      `/v1/conversations/${encodeURIComponent(conversationId)}?group_id=${encodeURIComponent(groupId)}`
    );
  }

  async deleteConversation(conversationId: string, groupId: string): Promise<void> {
    await this._request<unknown>(
      'DELETE',
      `/v1/conversations/${encodeURIComponent(conversationId)}?group_id=${encodeURIComponent(groupId)}`
    );
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  async listMessages(
    conversationId: string,
    groupId: string,
    limit?: number,
    before?: string
  ): Promise<Page<Message>> {
    const params = new URLSearchParams({ group_id: groupId });
    if (limit !== undefined) params.set('limit', String(limit));
    if (before !== undefined) params.set('before', before);
    return this._request<Page<Message>>(
      'GET',
      `/v1/conversations/${encodeURIComponent(conversationId)}/messages?${params}`
    );
  }

  /**
   * Send a message and wait for the AI reply (non-streaming).
   */
  async sendMessage(
    conversationId: string,
    groupId: string,
    userId: string,
    content: string,
    fileIds?: string[]
  ): Promise<Message> {
    return this._request<Message>(
      'POST',
      `/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        group_id: groupId,
        user_id: userId,
        content,
        stream: false,
        ...(fileIds && fileIds.length > 0 ? { file_ids: fileIds } : {}),
      }
    );
  }

  /**
   * Stream an AI response as SSE deltas.
   * Yields `Delta` objects for each `chat.delta` event.
   */
  async *streamMessage(
    conversationId: string,
    groupId: string,
    userId: string,
    content: string,
    fileIds?: string[]
  ): AsyncIterable<Delta> {
    const url = `${this.baseUrl}/v1/conversations/${encodeURIComponent(conversationId)}/messages`;
    const body = JSON.stringify({
      group_id: groupId,
      user_id: userId,
      content,
      stream: true,
      ...(fileIds && fileIds.length > 0 ? { file_ids: fileIds } : {}),
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body,
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
              const event = JSON.parse(payload) as { object?: string; message?: string; content?: string; delta?: { content?: string } };
              if (event.object === 'error') {
                throw new MettaraError(`SSE error: ${event.message ?? 'unknown'}`);
              }
              if (event.object === 'chat.activity' && event.content) {
                yield { content: event.content, type: 'activity' as const };
              } else if (event.object === 'chat.reasoning' && event.content) {
                yield { content: event.content, type: 'reasoning' as const };
              } else if (event.object === 'chat.delta' && event.delta?.content) {
                yield { content: event.delta.content, type: 'content' as const };
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

  async uploadFile(groupId: string, file: Uint8Array, filename: string): Promise<MFile> {
    const form = new FormData();
    form.append('group_id', groupId);
    form.append('file', new Blob([file]), filename);
    return this._requestRaw<MFile>('POST', '/v1/files', form);
  }

  async listFiles(groupId: string, limit?: number): Promise<Page<MFile>> {
    const params = new URLSearchParams({ group_id: groupId });
    if (limit !== undefined) params.set('limit', String(limit));
    return this._request<Page<MFile>>('GET', `/v1/files?${params}`);
  }

  async getFile(fileId: string, groupId: string): Promise<Uint8Array> {
    const response = await this._fetchWithRetry(
      `/v1/files/${encodeURIComponent(fileId)}/content?group_id=${encodeURIComponent(groupId)}`,
      { method: 'GET' }
    );
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async deleteFile(fileId: string, groupId: string): Promise<void> {
    await this._request<unknown>(
      'DELETE',
      `/v1/files/${encodeURIComponent(fileId)}?group_id=${encodeURIComponent(groupId)}`
    );
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async _request<T>(method: string, path: string, payload?: unknown): Promise<T> {
    const options: RequestInit = {
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
    return response.json() as Promise<T>;
  }

  private async _requestRaw<T>(method: string, path: string, body: FormData): Promise<T> {
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
      body,
    };
    const response = await this._fetchWithRetry(path, options);
    return response.json() as Promise<T>;
  }

  private async _fetchWithRetry(path: string, options: RequestInit): Promise<Response> {
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

      await new Promise<void>(resolve => setTimeout(resolve, delayMs));
    }
  }

  private async _throwForStatus(response: Response): Promise<never> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
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

export class EmbedError extends MettaraError {
  statusCode: number | null;
  constructor(message?: string, statusCode: number | null = null) {
    super(message);
    this.name = 'EmbedError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, EmbedError.prototype);
  }
}

export interface EmbedTokenResult {
  accessToken: string;
  expiresAt: number;
  userId: string;
  groupId: string;
  platformId: string;
}

export class EmbedClient {
  /**
   * Signs and sends embed token requests to the Mettara API.
   *
   * Handles JIT user provisioning: on first call for a given user Mettara
   * creates the user and group automatically, preserving sourceUserId and
   * sourceGroupId as external identifiers.
   *
   * @param secret   Platform API secret for HMAC signing
   * @param baseUrl  Mettara API base URL (e.g. https://api.mettara.ai)
   * @param platformId  Your platform UUID
   */
  constructor(
    private readonly secret: string,
    private readonly baseUrl: string,
    private readonly platformId: string
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** Exchange credentials for an embed JWT, provisioning the user if needed. */
  async getToken(
    sourceUserId: string,
    sourceGroupId: string,
    sourceGroupName: string,
    name: string,
    email: string
  ): Promise<EmbedTokenResult> {
    const params: Record<string, string> = {
      platform_id: this.platformId,
      source_user_id: sourceUserId,
      source_group_id: sourceGroupId,
      source_group_name: sourceGroupName,
      name,
      email: email.trim().toLowerCase(),
      t: this.currentTimestamp(),
    };
    params.sig = this.sign(params);
    return this.post('/embed/token', params);
  }

  /** Refresh an existing embed JWT without re-provisioning. */
  async refreshToken(sourceUserId: string, sourceGroupId: string): Promise<EmbedTokenResult> {
    const params: Record<string, string> = {
      platform_id: this.platformId,
      source_user_id: sourceUserId,
      source_group_id: sourceGroupId,
      t: this.currentTimestamp(),
    };
    params.sig = this.sign(params);
    return this.post('/embed/refresh', params);
  }

  private sign(params: Record<string, string>): string {
    const canonical = Object.keys(params)
      .sort()
      .map(k => `${this.rfc3986Encode(k)}=${this.rfc3986Encode(params[k])}`)
      .join('&');
    return crypto.createHmac('sha256', this.secret).update(canonical).digest('hex');
  }

  private rfc3986Encode(str: string): string {
    return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  }

  private currentTimestamp(): string {
    return new Date().toISOString();
  }

  private async post(path: string, payload: Record<string, string>): Promise<EmbedTokenResult> {
    const url = `${this.baseUrl}${path}`;
    let raw: any;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new EmbedError(`Embed token request failed: HTTP ${response.status}`, response.status);
      }
      raw = await response.json();
    } catch (err) {
      if (err instanceof EmbedError) throw err;
      throw new EmbedError(`Embed token request failed: ${(err as Error).message}`);
    }

    const result = raw?.result;
    if (!result?.access_token) {
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
