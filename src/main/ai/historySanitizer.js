// History Sanitizer for Gemini Multiturn Conversations
// Ensures strictly alternating user/model turns, drops empty/error messages, and caps length.

/**
 * Checks if text is an error bubble or system placeholder that should not be sent back to API.
 */
function isErrorOrPlaceholder(text) {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;

  const lower = trimmed.toLowerCase();
  if (trimmed.startsWith('⚠️')) return true;
  if (lower.startsWith('error:')) return true;
  if (lower.startsWith('quota limit reached:')) return true;
  if (lower.includes('no response received from the model')) return true;
  if (lower.includes('(no response received')) return true;
  if (lower.includes('failed to generate response')) return true;
  if (lower.includes('no response (reason:')) return true;
  if (lower.includes('no response (finish reason:')) return true;
  if (lower.includes('invalid argument in request')) return true;

  return false;
}

/**
 * Normalizes role to either 'user' or 'model'.
 */
function normalizeRole(role) {
  if (!role) return 'user';
  const lower = String(role).toLowerCase();
  return lower === 'assistant' || lower === 'model' ? 'model' : 'user';
}

/**
 * Sanitizes conversation history for Gemini API:
 * 1. Drops messages with empty text.
 * 2. Drops error bubbles and placeholder messages.
 * 3. Merges consecutive messages with the same role.
 * 4. Ensures history starts with a 'user' message.
 * 5. Ensures strict alternation of 'user' and 'model'.
 * 6. Caps length to maxMessages (default 10).
 *
 * @param {Array<{role: string, content: string}>} rawHistory
 * @param {number} maxMessages - Maximum messages to retain (default 10)
 * @returns {Array<{role: 'user'|'model', content: string}>}
 */
function sanitizeHistory(rawHistory = [], maxMessages = 10) {
  if (!Array.isArray(rawHistory) || rawHistory.length === 0) {
    return [];
  }

  // Step 1: Filter out empty strings, error bubbles, and placeholders
  const validMessages = [];
  for (const msg of rawHistory) {
    if (!msg || typeof msg !== 'object') continue;
    const content = typeof msg.content === 'string' ? msg.content.trim() : '';
    if (!content) continue; // drop empty text
    if (isErrorOrPlaceholder(content)) continue; // drop error bubbles

    validMessages.push({
      role: normalizeRole(msg.role),
      content,
    });
  }

  if (validMessages.length === 0) {
    return [];
  }

  // Step 2: Merge consecutive messages with the same role
  const merged = [];
  for (const msg of validMessages) {
    if (merged.length === 0) {
      merged.push({ role: msg.role, content: msg.content });
    } else {
      const prev = merged[merged.length - 1];
      if (prev.role === msg.role) {
        // Merge consecutive same-role messages
        prev.content = `${prev.content}\n\n${msg.content}`;
      } else {
        merged.push({ role: msg.role, content: msg.content });
      }
    }
  }

  // Step 3: Ensure history starts with a 'user' message
  while (merged.length > 0 && merged[0].role !== 'user') {
    merged.shift();
  }

  if (merged.length === 0) {
    return [];
  }

  // Step 4: Cap length to maxMessages
  let result = merged;
  if (result.length > maxMessages) {
    result = result.slice(-maxMessages);
    // If slicing causes result to start with a 'model' message, drop it so it starts with 'user'
    while (result.length > 0 && result[0].role !== 'user') {
      result.shift();
    }
  }

  return result;
}

module.exports = {
  sanitizeHistory,
  isErrorOrPlaceholder,
  normalizeRole,
};
