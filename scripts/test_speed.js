const { app, safeStorage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

const targetDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Coder Browser');
app.setPath('userData', targetDir);

async function timeoutPromise(p, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

app.whenReady().then(async () => {
  try {
    const keyBuf = fs.readFileSync(path.join(targetDir, 'ai-key.bin'));
    const apiKey = safeStorage.decryptString(keyBuf);
    const client = new GoogleGenAI({ apiKey });
    const model = 'gemini-3.8-flash';

    console.log('\n=== MEASURING SPEED: Default vs thinkingBudget: 0 ===');

    for (const prompt of ['hi', 'what is gambling']) {
      console.log(`\n-----------------------------------------------------`);
      console.log(`PROMPT: "${prompt}"`);
      console.log(`-----------------------------------------------------`);

      // Run 1: Default thinking
      try {
        const tStart = Date.now();
        let tFirstChunk = null;
        let chunkCount = 0;
        let thinkingTokens = 0;
        let promptTokens = 0;
        let candidateTokens = 0;

        const stream = await timeoutPromise(
          client.models.generateContentStream({
            model,
            contents: prompt,
          }),
          8000,
          'stream connection'
        );

        const tConnected = Date.now() - tStart;

        for await (const chunk of stream) {
          chunkCount++;
          // check for text
          let hasText = false;
          chunk.candidates?.forEach(c => {
            c.content?.parts?.forEach(p => {
              if (!p.thought && p.text) hasText = true;
            });
          });
          if (hasText && tFirstChunk === null) {
            tFirstChunk = Date.now() - tStart;
          }
          if (chunk.usageMetadata) {
            thinkingTokens = chunk.usageMetadata.thoughtsTokenCount || 0;
            promptTokens = chunk.usageMetadata.promptTokenCount || 0;
            candidateTokens = chunk.usageMetadata.candidatesTokenCount || 0;
          }
        }
        const tTotal = Date.now() - tStart;
        console.log(`[DEFAULT] TTFB: ${tConnected}ms | First Text: ${tFirstChunk}ms | Total: ${tTotal}ms | Thinking Tokens: ${thinkingTokens} | Out Tokens: ${candidateTokens}`);
      } catch (e) {
        console.log(`[DEFAULT] Error: ${e.message}`);
      }

      // Run 2: Fast (thinkingBudget: 0)
      try {
        const tStart = Date.now();
        let tFirstChunk = null;
        let chunkCount = 0;
        let thinkingTokens = 0;
        let promptTokens = 0;
        let candidateTokens = 0;

        const stream = await timeoutPromise(
          client.models.generateContentStream({
            model,
            contents: prompt,
            config: {
              thinkingConfig: {
                thinkingBudget: 0,
              },
            },
          }),
          8000,
          'stream connection (budget 0)'
        );

        const tConnected = Date.now() - tStart;

        for await (const chunk of stream) {
          chunkCount++;
          let hasText = false;
          chunk.candidates?.forEach(c => {
            c.content?.parts?.forEach(p => {
              if (!p.thought && p.text) hasText = true;
            });
          });
          if (hasText && tFirstChunk === null) {
            tFirstChunk = Date.now() - tStart;
          }
          if (chunk.usageMetadata) {
            thinkingTokens = chunk.usageMetadata.thoughtsTokenCount || 0;
            promptTokens = chunk.usageMetadata.promptTokenCount || 0;
            candidateTokens = chunk.usageMetadata.candidatesTokenCount || 0;
          }
        }
        const tTotal = Date.now() - tStart;
        console.log(`[FAST (budget: 0)] TTFB: ${tConnected}ms | First Text: ${tFirstChunk}ms | Total: ${tTotal}ms | Thinking Tokens: ${thinkingTokens} | Out Tokens: ${candidateTokens}`);
      } catch (e) {
        console.log(`[FAST] Error: ${e.message}`);
      }
    }
  } catch (err) {
    console.error('Speed test error:', err);
  } finally {
    app.quit();
  }
});
