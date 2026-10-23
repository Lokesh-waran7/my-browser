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
   * Tests whether the API key and model connectivity work.
   * @returns {Promise<{ success: boolean, message: string, error?: string }>}
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
  constructor({ apiKey, model = 'gemini-2.5-flash' } = {}) {
    super({ name: 'gemini', model });
    this.apiKey = apiKey;
    this.model = model || 'gemini-2.5-flash';

    if (this.apiKey) {
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    } else {
      this.client = null;
    }
  }

  /**
   * Parses and categorizes API errors into user-friendly messages.
   */
  formatError(err) {
    const raw = (err && err.message) || String(err || 'Unknown error');
    const lower = raw.toLowerCase();

    if (lower.includes('api_key_invalid') || lower.includes('api key not valid') || lower.includes('invalid api key')) {
      return {
        type: 'invalid_key',
        message: 'Invalid API key. Please check your Gemini API key in settings.',
      };
    }
    if (lower.includes('403') || lower.includes('permission_denied') || lower.includes('permission denied')) {
      return {
        type: 'forbidden',
        message: 'Permission denied. Ensure your Gemini API key has access to the selected model.',
      };
    }
    if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota') || lower.includes('rate limit')) {
      return {
        type: 'quota_exceeded',
        message: 'Quota exceeded or rate limit reached. Please wait a moment and try again.',
      };
    }
    if (lower.includes('enotfound') || lower.includes('fetch failed') || lower.includes('econnrefused') || lower.includes('network')) {
      return {
        type: 'no_internet',
        message: 'Network error: Unable to connect to Gemini API. Please check your internet connection.',
      };
    }
    if (lower.includes('abort') || lower.includes('timeout')) {
      return {
        type: 'timeout',
        message: 'Request timed out or was cancelled by user.',
      };
    }

    return {
      type: 'general',
      message: raw.length > 200 ? raw.slice(0, 200) + '...' : raw,
    };
  }

  /**
   * Tests connection with a minimal prompt.
   */
  async testConnection() {
    if (!this.apiKey) {
      return { success: false, message: 'No API key provided. Please enter a valid Gemini API key.' };
    }

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: 'Hello, reply with "OK".',
      });

      if (response && response.text) {
        return {
          success: true,
          message: `Connection successful! Connected to Gemini using model: ${this.model}`,
        };
      }
      return {
        success: true,
        message: `Connected successfully to model: ${this.model}`,
      };
    } catch (err) {
      const formatted = this.formatError(err);
      return {
        success: false,
        message: formatted.message,
        error: formatted.type,
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
      throw new Error(formatted.message);
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
