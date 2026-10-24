// scripts/ai-smoke.js - Standalone diagnostic test for Gemini API
// Reads stored key via safeStorage or GEMINI_API_KEY env var
// Tests non-streaming generateContent, then streaming, and logs detailed timing & parsed output.

const path = require('path');
const os = require('os');
const fs = require('fs');

async function getApiKey() {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY.trim();
  }

  // Attempt electron safeStorage read
  try {
    const electron = require('electron');
    if (electron && electron.app) {
      const targetDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Coder Browser');
      if (typeof electron.app.setPath === 'function') {
        electron.app.setPath('userData', targetDir);
      }
      if (electron.app.whenReady) {
        await electron.app.whenReady();
      }
      const keyFile = path.join(targetDir, 'ai-key.bin');
      if (fs.existsSync(keyFile)) {
        const buf = fs.readFileSync(keyFile);
        if (electron.safeStorage && electron.safeStorage.isEncryptionAvailable()) {
          return electron.safeStorage.decryptString(buf);
        } else {
          const str = buf.toString();
          if (str.startsWith('RAW:')) {
            return Buffer.from(str.slice(4), 'base64').toString('utf8');
          }
        }
      }
    }
  } catch (err) {
    console.warn('Could not read key from safeStorage:', err.message);
  }

  return null;
}

async function main() {
  const timeoutTimer = setTimeout(() => {
    console.error('\n[TIMEOUT] ai-smoke.js exceeded 30s timeout.');
    process.exit(1);
  }, 30000);

  try {
    console.log('=== AI SMOKE TEST STARTING ===');
    const apiKey = await getApiKey();
    if (!apiKey) {
      console.error('ERROR: No Gemini API key found in safeStorage or GEMINI_API_KEY env.');
      process.exit(1);
    }

    console.log(`API Key detected (length: ${apiKey.length}, starts with: ${apiKey.slice(0, 4)}...)`);

    const { GoogleGenAI } = require('@google/genai');
    const client = new GoogleGenAI({ apiKey });
    const model = 'gemini-3.8-flash';

    console.log(`\n--- TEST 1: Non-streaming generateContent (model: ${model}) ---`);
    const t0 = Date.now();
    try {
      const nonStreamRes = await client.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      });
      const tNonStream = Date.now() - t0;
      console.log(`HTTP Status: 200 OK (${tNonStream}ms)`);
      console.log('Candidates count:', nonStreamRes.candidates?.length || 0);

      let parsedText = '';
      if (nonStreamRes.candidates && nonStreamRes.candidates[0]) {
        const c0 = nonStreamRes.candidates[0];
        console.log('Candidate[0] finishReason:', c0.finishReason);
        if (c0.content?.parts) {
          c0.content.parts.forEach((p, idx) => {
            console.log(`  Part[${idx}]: thought=${p.thought}, textLen=${p.text?.length || 0}`);
            if (!p.thought && p.text) {
              parsedText += p.text;
            }
          });
        }
      }
      if (!parsedText && nonStreamRes.text) {
        parsedText = nonStreamRes.text;
      }
      console.log('Parsed Answer Text:', JSON.stringify(parsedText.trim()));
      console.log('Usage Metadata:', nonStreamRes.usageMetadata);
    } catch (e) {
      console.error('Non-streaming failed:', e.status || e.code, e.message);
    }

    console.log(`\n--- TEST 2: Streaming generateContentStream (model: ${model}) ---`);
    const t1 = Date.now();
    try {
      const streamRes = await client.models.generateContentStream({
        model,
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      });

      console.log('Stream generator connected. Consuming chunks:');
      let chunkCount = 0;
      let streamedAnswer = '';
      let finishReason = null;

      for await (const chunk of streamRes) {
        chunkCount++;
        let chunkText = '';
        if (chunk.candidates && Array.isArray(chunk.candidates)) {
          for (const cand of chunk.candidates) {
            if (cand.finishReason) finishReason = cand.finishReason;
            if (cand.content?.parts) {
              for (const part of cand.content.parts) {
                if (part.thought) {
                  // Skip thoughts in answer stream
                  continue;
                }
                if (part.text) {
                  chunkText += part.text;
                }
              }
            }
          }
        }
        if (!chunkText && typeof chunk.text === 'string') {
          chunkText = chunk.text;
        }

        console.log(`  Chunk #${chunkCount}: keys=[${Object.keys(chunk).join(', ')}] textLen=${chunkText.length} snippet=${JSON.stringify(chunkText)}`);
        streamedAnswer += chunkText;
      }

      const tStream = Date.now() - t1;
      console.log(`Stream finished in ${tStream}ms! Total chunks: ${chunkCount}, finishReason: ${finishReason}`);
      console.log('Full Streamed Answer:', JSON.stringify(streamedAnswer.trim()));
    } catch (e) {
      console.error('Streaming failed:', e.status || e.code, e.message);
    }

    console.log('\n=== AI SMOKE TEST FINISHED ===');
  } catch (err) {
    console.error('Fatal smoke test error:', err);
  } finally {
    clearTimeout(timeoutTimer);
    try {
      const electron = require('electron');
      if (electron && electron.app && typeof electron.app.quit === 'function') {
        electron.app.quit();
      }
    } catch (_) {}
    process.exit(0);
  }
}

main();
