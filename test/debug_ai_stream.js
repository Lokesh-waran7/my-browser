const { app, safeStorage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

const targetDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Coder Browser');
app.setPath('userData', targetDir);

app.whenReady().then(async () => {
  try {
    const keyPath = path.join(targetDir, 'ai-key.bin');
    const keyBuf = fs.readFileSync(keyPath);
    const apiKey = safeStorage.decryptString(keyBuf);
    console.log('API key loaded (length:', apiKey.length, ')');

    const client = new GoogleGenAI({ apiKey });
    const model = 'gemini-3.8-flash';

    console.log('\n======================================================');
    console.log('TEST 1: Non-streaming generateContent ("hi")');
    console.log('======================================================');
    try {
      const nonStreamRes = await client.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      });
      console.log('Non-streaming top-level keys:', Object.keys(nonStreamRes || {}));
      console.log('Non-streaming candidates count:', nonStreamRes.candidates?.length);
      if (nonStreamRes.candidates) {
        nonStreamRes.candidates.forEach((c, idx) => {
          console.log(`Candidate[${idx}] finishReason:`, c.finishReason);
          console.log(`Candidate[${idx}] content role:`, c.content?.role);
          console.log(`Candidate[${idx}] parts count:`, c.content?.parts?.length);
          if (c.content?.parts) {
            c.content.parts.forEach((p, pIdx) => {
              console.log(`  Part[${pIdx}] keys:`, Object.keys(p), 'thought:', p.thought, 'textLen:', p.text?.length, 'textSnippet:', JSON.stringify(p.text ? p.text.slice(0, 60) : ''));
            });
          }
        });
      }
      console.log('nonStreamRes.text getter:', JSON.stringify(nonStreamRes.text));
      console.log('usageMetadata:', nonStreamRes.usageMetadata);
      console.log('promptFeedback:', nonStreamRes.promptFeedback);
    } catch (e) {
      console.error('Non-streaming error:', e);
    }

    console.log('\n======================================================');
    console.log('TEST 2: Streaming generateContentStream ("hi")');
    console.log('======================================================');
    try {
      const streamRes = await client.models.generateContentStream({
        model,
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      });
      console.log('Stream generator obtained. Reading chunks...');
      let chunkCount = 0;
      for await (const chunk of streamRes) {
        chunkCount++;
        console.log(`\n--- Chunk #${chunkCount} ---`);
        console.log('Chunk keys:', Object.keys(chunk));
        console.log('chunk.text getter:', JSON.stringify(chunk.text));
        if (chunk.candidates) {
          chunk.candidates.forEach((c, cIdx) => {
            console.log(`Cand[${cIdx}] finishReason:`, c.finishReason);
            if (c.content?.parts) {
              c.content.parts.forEach((p, pIdx) => {
                console.log(`  Part[${pIdx}] keys:`, Object.keys(p), 'thought:', p.thought, 'textLen:', p.text?.length, 'snippet:', JSON.stringify(p.text ? p.text.slice(0, 40) : ''));
              });
            }
          });
        }
        if (chunk.usageMetadata) console.log('Chunk usageMetadata:', chunk.usageMetadata);
      }
      console.log(`\nStream ended. Total chunks: ${chunkCount}`);
    } catch (e) {
      console.error('Streaming error:', e);
    }

  } catch (err) {
    console.error('Fatal test error:', err);
  } finally {
    app.quit();
  }
});
