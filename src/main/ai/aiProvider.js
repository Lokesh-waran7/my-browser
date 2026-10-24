// AI Provider Interface & Gemini Implementation using official @google/genai SDK
const { GoogleGenAI } = require('@google/genai');
const netdebugLogger = require('../netdebugLogger');

/**
 * Checks whether a given model supports reasoning/thinking configuration.
 * Models like Flash-Lite do not support thinkingConfig and will reject it with HTTP 400.
 */
function modelSupportsThinking(modelId) {
  if (!modelId || typeof modelId !== 'string') return false;
  const lower = modelId.toLowerCase();
  // Flash-Lite and Nano models never support thinkingConfig
  if (lower.includes('flash-lite') || lower.includes('lite') || lower.includes('nano')) {
    return false;
  }
  // Explicit thinking models
  if (lower.includes('thinking')) return true;
  // Gemini 2.5 Flash / Pro and Gemini 3.7+ Flash / Pro
  if (lower.includes('2.5-flash') || lower.includes('2.5-pro')) return true;
  if (lower.includes('3.7-flash') || lower.includes('3.7-pro')) return true;
  if (lower.includes('3.8-flash') || lower.includes('3.8-pro')) return true;
  // Omit if unsure
  return false;
}

/**
 * Base AI Provider Interface to allow adding other providers (Anthropic, OpenAI, Ollama) later.
 */
class AIProvider {
  constructor(config = {}) {
    this.name = config.name || 'base';
    this.model = config.model || '';
  }

  async listModels() {
    throw new Error('listModels() must be implemented by provider');
  }

  async testConnection() {
    throw new Error('testConnection() must be implemented by provider');
  }

  async generateStream(options) {
    throw new Error('generateStream() must be implemented by provider');
  }
}

/**
 * Gemini Provider using the official Google Gen AI SDK (@google/genai).
 * Uses the SDK's default fetcher (undici/Node HTTP) to bypass Electron's
 * session.webRequest handlers and ensure AI requests are never blocked.
 */
class GeminiProvider extends AIProvider {
  constructor({ apiKey, model = '' } = {}) {
    super({ name: 'gemini', model });
    this.apiKey = apiKey;
    this.model = model || '';

    if (this.apiKey) {
      // Do NOT pass httpOptions.fetch — let the SDK use its default undici fetcher
      // which goes directly through Node HTTP without touching Electron's session.webRequest.
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    } else {
      this.client = null;
    }
  }

  formatError(err) {
    const raw = (err && (err.message || String(err))) || 'Unknown error';
    const rawDetails = (err && (err.stack || (typeof err === 'object' ? JSON.stringify(err, null, 2) : String(err)))) || raw;
    const lower = raw.toLowerCase();
    const status = (err && (err.status || err.code)) || null;

    const isRetireOrNotFound = status === 404 ||
      lower.includes('404') ||
      lower.includes('not_found') ||
      lower.includes('no longer available') ||
      lower.includes('not found') ||
      lower.includes('retired');

    if (isRetireOrNotFound) {
      return {
        type: 'wrong_model',
        message: `Model "${this.model || 'selected'}" is no longer available or was retired.`,
        details: rawDetails,
        status: 404,
        isRetireOrNotFound: true,
      };
    }

    if (status === 400 || lower.includes('400') || lower.includes('invalid_argument') || lower.includes('invalid argument')) {
      let fieldMsg = raw;
      try {
        if (typeof err === 'object' && err !== null) {
          if (err.error && err.error.message) {
            fieldMsg = err.error.message;
          } else if (err.message) {
            fieldMsg = err.message;
          }
          if (err.error && Array.isArray(err.error.details) && err.error.details.length > 0) {
            const detailStrs = err.error.details.map((d) => (typeof d === 'object' ? JSON.stringify(d) : String(d)));
            fieldMsg += '\nDetails: ' + detailStrs.join('; ');
          }
        }
      } catch (_) {}

      netdebugLogger.log('AI:400ErrorBody', `HTTP 400 Invalid Argument: ${fieldMsg}`, { rawDetails });

      return {
        type: 'invalid_argument',
        message: `Request contains an invalid argument (HTTP 400): ${fieldMsg}`,
        details: fieldMsg + (rawDetails !== fieldMsg ? '\n\nFull error:\n' + rawDetails : ''),
        status: 400,
        isRetireOrNotFound: false,
      };
    }

    if (lower.includes('api_key_invalid') || lower.includes('api key not valid') || lower.includes('invalid api key')) {
      return {
        type: 'invalid_key',
        message: 'Invalid API key. Please verify your Gemini API key in settings.',
        details: rawDetails,
        status: status || 400,
        isRetireOrNotFound: false,
      };
    }

    if (status === 403 || lower.includes('403') || lower.includes('permission_denied') || lower.includes('permission denied')) {
      return {
        type: 'forbidden',
        message: 'Permission denied. Ensure your Gemini API key has access to the selected model.',
        details: rawDetails,
        status: 403,
        isRetireOrNotFound: false,
      };
    }

    if (status === 429 || lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota') || lower.includes('rate limit')) {
      return {
        type: 'quota_exceeded',
        message: 'Quota exceeded or rate limit reached. Please wait a moment before trying again.',
        details: rawDetails,
        status: 429,
        isRetireOrNotFound: false,
      };
    }

    if (status === 503 || lower.includes('503') || lower.includes('high demand') || lower.includes('spikes in demand') || lower.includes('unavailable')) {
      return {
        type: 'high_demand',
        message: 'The model is temporarily experiencing high demand. Please try again shortly.',
        details: rawDetails,
        status: 503,
        isRetireOrNotFound: false,
      };
    }

    if (lower.includes('enotfound') || lower.includes('fetch failed') || lower.includes('econnrefused') || lower.includes('network')) {
      return {
        type: 'no_internet',
        message: 'Network error: Unable to connect to Gemini API. Please check your internet connection.',
        details: rawDetails,
        status: status,
        isRetireOrNotFound: false,
      };
    }

    if (lower.includes('abort') || lower.includes('timeout')) {
      return {
        type: 'timeout',
        message: raw.includes('30s') ? 'Stream timed out: 30 seconds elapsed without receiving a chunk.' : 'Request timed out or was cancelled by user.',
        details: rawDetails,
        status: status,
        isRetireOrNotFound: false,
      };
    }

    let cleanMessage = raw;
    try {
      if (raw.trim().startsWith('{')) {
        const parsed = JSON.parse(raw);
        if (parsed.error && parsed.error.message) {
          cleanMessage = parsed.error.message;
        }
      }
    } catch (_) {}

    return {
      type: 'general',
      message: cleanMessage.length > 200 ? cleanMessage.slice(0, 200) + '...' : cleanMessage,
      details: rawDetails,
      status: status,
      isRetireOrNotFound: false,
    };
  }

  async listModels() {
    if (!this.client) {
      throw new Error('Gemini API key is not configured.');
    }

    netdebugLogger.log('AI:Models', 'Fetching available models from Gemini API...');
    const response = await this.client.models.list();
    const modelsList = [];

    if (Array.isArray(response)) {
      modelsList.push(...response);
    } else if (response && typeof response[Symbol.asyncIterator] === 'function') {
      for await (const m of response) {
        modelsList.push(m);
      }
    } else if (response && Array.isArray(response.models)) {
      modelsList.push(...response.models);
    } else if (response && typeof response.page === 'function') {
      for await (const m of response) {
        modelsList.push(m);
      }
    } else if (response) {
      modelsList.push(response);
    }

    netdebugLogger.log('AI:Models', `Retrieved ${modelsList.length} models.`);
    return modelsList;
  }

  async testConnection() {
    if (!this.apiKey) {
      return { success: false, message: 'No API key provided. Please enter a valid Gemini API key.' };
    }
    if (!this.model) {
      return { success: false, message: 'No model selected. Please select a valid Gemini model.' };
    }

    netdebugLogger.log('AI:Test', `Testing connection for model: ${this.model}`);
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: 'Hello, reply with "OK".',
      });

      if (response && response.text) {
        return {
          success: true,
          message: `Connection successful! Connected using model: ${this.model}`,
          model: this.model,
        };
      }

      return {
        success: true,
        message: `Connected successfully to model: ${this.model}`,
        model: this.model,
      };
    } catch (err) {
      netdebugLogger.log('AI:TestError', `Test connection failed: ${err.message}`);
      const formatted = this.formatError(err);
      return {
        success: false,
        message: formatted.message,
        error: formatted.type,
        details: formatted.details,
        status: formatted.status,
      };
    }
  }

  /**
   * Robust streaming parser:
   * 1. Handles text spread across candidates[0].content.parts[*].text.
   * 2. Skips "thought" reasoning parts so user gets clean answers.
   * 3. Tolerates empty chunks.
   * 4. Enforces a 30-second per-chunk idle timeout.
   * 5. Logs chunk structures, finishReason, promptFeedback, usage metadata.
   * 6. Ensures stream always ends with content or clear explanation.
   * 7. Supports thinkingBudget for controlling response speed.
   *
   * @param {object} options
   * @param {Array}  options.messages         - Chat history
   * @param {string} options.systemInstruction
   * @param {AbortSignal} options.signal
   * @param {function} options.onChunk        - Called with each text chunk
   * @param {number|null} options.thinkingBudget - 0=fast, 512=balanced, -1=deep (null=model default)
   * @param {function|null} options.onTiming  - Called with timing object at stream end
   */
  async generateStream({ messages = [], systemInstruction = '', signal, onChunk, thinkingBudget = null, onTiming = null }) {
    if (!this.client) {
      throw new Error('Gemini API key is not configured.');
    }
    if (!this.model) {
      throw new Error('No model configured for AI Assistant.');
    }

    const formattedContents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || '' }],
    }));

    let fullText = '';
    let lastFinishReason = null;
    let blockReason = null;

    netdebugLogger.log('AI:Stream', `Starting stream request with model: ${this.model}${thinkingBudget !== null ? ` | thinkingBudget: ${thinkingBudget}` : ''}`);

    const t_send = Date.now();

    try {
      const config = {};
      if (systemInstruction) {
        config.systemInstruction = systemInstruction;
      }
      // Apply thinking budget ONLY if supported by model (e.g. Flash-Lite rejects thinkingConfig)
      const canThink = modelSupportsThinking(this.model);
      if (canThink && thinkingBudget !== null && typeof thinkingBudget === 'number') {
        config.thinkingConfig = { thinkingBudget };
      }

      // Log request SHAPE (no message content or keys)
      const rolesSeq = formattedContents.map((c) => c.role).join(' -> ');
      netdebugLogger.log(
        'AI:RequestShape',
        `Model: ${this.model} | MessagesCount: ${formattedContents.length} | Roles: [${rolesSeq}] | Config: ${JSON.stringify({
          thinkingConfig: config.thinkingConfig || 'omitted (unsupported or unset)',
          systemInstruction: config.systemInstruction ? 'set' : 'unset',
          temperature: 'default',
          safetySettings: 'default',
          tools: 'none',
        })}`
      );

      const responseStream = await this.client.models.generateContentStream({
        model: this.model,
        contents: formattedContents,
        config,
      });

      // 30s per-chunk timeout controller
      let chunkTimeoutTimer = null;
      let isCompleted = false;

      const resetChunkTimeout = () => {
        if (chunkTimeoutTimer) clearTimeout(chunkTimeoutTimer);
        chunkTimeoutTimer = setTimeout(() => {
          if (!isCompleted) {
            const timeoutErr = new Error('Stream timed out: 30s elapsed without receiving a chunk.');
            timeoutErr.code = 'ETIMEDOUT';
            if (signal && typeof signal.abort === 'function') signal.abort();
            throw timeoutErr;
          }
        }, 30000);
      };

      resetChunkTimeout();
      let chunkIndex = 0;
      let t_firstChunk = null;
      let lastUsageMeta = null;

      try {
        for await (const chunk of responseStream) {
          chunkIndex++;
          resetChunkTimeout();

          if (!t_firstChunk) t_firstChunk = Date.now();

          if (signal && signal.aborted) {
            throw new Error('Request aborted by user');
          }

          const chunkKeys = Object.keys(chunk || {});
          let textFromParts = '';

          // Inspect candidates and parts
          if (chunk && Array.isArray(chunk.candidates)) {
            for (const cand of chunk.candidates) {
              if (cand.finishReason) {
                lastFinishReason = cand.finishReason;
              }
              if (cand.content && Array.isArray(cand.content.parts)) {
                for (const part of cand.content.parts) {
                  // Skip thoughts in the user visible chat output
                  if (part.thought === true) continue;
                  if (typeof part.text === 'string' && part.text.length > 0) {
                    textFromParts += part.text;
                  }
                }
              }
            }
          }

          // Fallback to chunk.text getter if parts yielded no text
          let finalChunkText = textFromParts;
          if (!finalChunkText && typeof chunk.text === 'string') {
            finalChunkText = chunk.text;
          }

          if (chunk.promptFeedback && chunk.promptFeedback.blockReason) {
            blockReason = chunk.promptFeedback.blockReason;
          }

          // Capture usage metadata from any chunk that carries it
          if (chunk.usageMetadata) {
            lastUsageMeta = chunk.usageMetadata;
          }

          netdebugLogger.log('AI:Chunk', `Chunk #${chunkIndex} | Keys: [${chunkKeys.join(',')}] | TextLen: ${finalChunkText.length} | FinishReason: ${lastFinishReason || 'none'}`);

          if (finalChunkText) {
            fullText += finalChunkText;
            if (onChunk) {
              onChunk(finalChunkText);
            }
          }
        }
      } finally {
        isCompleted = true;
        if (chunkTimeoutTimer) clearTimeout(chunkTimeoutTimer);
      }

      const t_end = Date.now();

      // Report timing
      const timingInfo = {
        t_send,
        t_firstChunk: t_firstChunk || t_end,
        t_total: t_end - t_send,
        ms_to_first_chunk: t_firstChunk ? t_firstChunk - t_send : null,
        totalChunks: chunkIndex,
        totalChars: fullText.length,
        thinkingTokens: lastUsageMeta ? (lastUsageMeta.thoughtsTokenCount || 0) : null,
        candidateTokens: lastUsageMeta ? (lastUsageMeta.candidatesTokenCount || 0) : null,
        promptTokens: lastUsageMeta ? (lastUsageMeta.promptTokenCount || 0) : null,
      };
      netdebugLogger.log('AI:Timing', `total=${timingInfo.t_total}ms | first_chunk=${timingInfo.ms_to_first_chunk}ms | chunks=${chunkIndex} | chars=${fullText.length} | thinkingTok=${timingInfo.thinkingTokens} | candTok=${timingInfo.candidateTokens}`);
      if (onTiming) onTiming(timingInfo);

      // If finished with empty text, investigate and provide clear explanation
      if (!fullText.trim()) {
        netdebugLogger.log('AI:EmptyStream', `Stream completed with empty text. FinishReason: ${lastFinishReason}, BlockReason: ${blockReason}`);
        if (blockReason) {
          fullText = `No response (request blocked: ${blockReason}).`;
        } else if (lastFinishReason && lastFinishReason !== 'STOP') {
          fullText = `No response (finish reason: ${lastFinishReason}).`;
        } else {
          // Attempt non-streaming fallback to recover content if streaming yielded nothing
          netdebugLogger.log('AI:Fallback', 'Attempting non-streaming generateContent fallback...');
          try {
            const fallbackRes = await this.client.models.generateContent({
              model: this.model,
              contents: formattedContents,
              config,
            });
            if (fallbackRes && fallbackRes.text) {
              fullText = fallbackRes.text;
              if (onChunk) onChunk(fullText);
            }
          } catch (fbErr) {
            netdebugLogger.log('AI:FallbackError', `Fallback failed: ${fbErr.message}`);
          }
          if (!fullText.trim()) {
            fullText = 'No response received from the model. Please verify prompt or retry.';
          }
        }
      }

      netdebugLogger.log('AI:StreamEnd', `Stream finished successfully. Total length: ${fullText.length} chars.`);
      return fullText;
    } catch (err) {
      if (signal && signal.aborted) {
        throw new Error('Request stopped by user.');
      }
      netdebugLogger.log('AI:StreamError', `Streaming failed: ${err.message}`, { stack: err.stack });
      const formatted = this.formatError(err);
      const streamErr = new Error(formatted.message);
      streamErr.type = formatted.type;
      streamErr.details = formatted.details;
      streamErr.status = formatted.status;
      streamErr.isRetireOrNotFound = formatted.isRetireOrNotFound;
      throw streamErr;
    }
  }
}

function createAIProvider(type = 'gemini', options = {}) {
  switch (type.toLowerCase()) {
    case 'gemini':
    default:
      return new GeminiProvider(options);
  }
}

module.exports = {
  AIProvider,
  GeminiProvider,
  createAIProvider,
  modelSupportsThinking,
};
