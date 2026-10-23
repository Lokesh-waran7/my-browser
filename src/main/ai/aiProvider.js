// AI Provider Interface & Gemini Implementation using official @google/genai SDK
const { GoogleGenAI } = require('@google/genai');

/**
 * Base AI Provider Interface to allow adding other providers (Anthropic, OpenAI, Ollama) later.
 */
class AIProvider {
  constructor(config = {}) {
    this.name = config.name || 'base';
    this.model = config.model || '';
  }

  /**
   * Lists available models from the provider.
   * @returns {Promise<Array<Object>>}
   */
  async listModels() {
    throw new Error('listModels() must be implemented by provider');
  }

  /**
   * Tests whether the API key and model connectivity work.
   * @returns {Promise<{ success: boolean, message: string, error?: string, details?: string }>}
   */
  async testConnection() {
    throw new Error('testConnection() must be implemented by provider');
  }

  /**
   * Generates a streaming response for conversation messages.
   * @param {Object} options
   * @param {Array<{ role: string, content: string }>} options.messages
   * @param {string} options.systemInstruction
   * @param {AbortSignal} options.signal
   * @param {Function} options.onChunk - Callback receiving string tokens as they arrive
   * @returns {Promise<string>} Full assembled text
   */
  async generateStream(options) {
    throw new Error('generateStream() must be implemented by provider');
  }
}

/**
 * Gemini Provider using the official Google Gen AI SDK (@google/genai)
 */
class GeminiProvider extends AIProvider {
  constructor({ apiKey, model = '' } = {}) {
    super({ name: 'gemini', model });
    this.apiKey = apiKey;
    this.model = model || '';

    if (this.apiKey) {
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    } else {
      this.client = null;
    }
  }

  /**
   * Parses and categorizes API errors into user-friendly messages with technical details.
   */
  formatError(err) {
    const raw = (err && (err.message || String(err))) || 'Unknown error';
    const rawDetails = (err && (err.stack || (typeof err === 'object' ? JSON.stringify(err, null, 2) : String(err)))) || raw;
    const lower = raw.toLowerCase();

    const status = (err && (err.status || err.code)) || null;

    // Check for model 404 / retirement
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
        message: 'The model or service is temporarily experiencing high demand. Please try again shortly.',
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
        message: 'Request timed out or was cancelled by user.',
        details: rawDetails,
        status: status,
        isRetireOrNotFound: false,
      };
    }

    // Friendly fallback without showing messy JSON syntax directly to user
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

  /**
   * Lists models supported by the Gemini API.
   */
  async listModels() {
    if (!this.client) {
      throw new Error('Gemini API key is not configured.');
    }

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

    return modelsList;
  }

  /**
   * Tests connection with a minimal prompt.
   */
  async testConnection() {
    if (!this.apiKey) {
      return { success: false, message: 'No API key provided. Please enter a valid Gemini API key.' };
    }
    if (!this.model) {
      return { success: false, message: 'No model selected. Please select a valid Gemini model.' };
    }

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
   * Streams response tokens as they arrive.
   */
  async generateStream({ messages = [], systemInstruction = '', signal, onChunk }) {
    if (!this.client) {
      throw new Error('Gemini API key is not configured.');
    }
    if (!this.model) {
      throw new Error('No model configured for AI Assistant.');
    }

    // Format chat messages according to @google/genai schema
    const formattedContents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || '' }],
    }));

    let fullText = '';

    try {
      const config = {};
      if (systemInstruction) {
        config.systemInstruction = systemInstruction;
      }

      const responseStream = await this.client.models.generateContentStream({
        model: this.model,
        contents: formattedContents,
        config,
      });

      for await (const chunk of responseStream) {
        if (signal && signal.aborted) {
          throw new Error('Request aborted by user');
        }

        const chunkText = chunk.text || '';
        if (chunkText) {
          fullText += chunkText;
          if (onChunk) {
            onChunk(chunkText);
          }
        }
      }

      return fullText;
    } catch (err) {
      if (signal && signal.aborted) {
        throw new Error('Request stopped by user.');
      }
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

/**
 * Factory helper for creating providers
 */
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
};
