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

    const client = new GoogleGenAI({ apiKey });
    const model = 'gemini-3.8-flash';

    console.log('Testing streaming multiple attempts if 503 occurs...');
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`\n--- Attempt #${attempt} ---`);
      try {
        const streamRes = await client.models.generateContentStream({
          model,
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        });
        console.log('Got stream iterator! Iterating chunks:');
        let count = 0;
        for await (const chunk of streamRes) {
          count++;
          console.log(`[Chunk #${count}] keys:`, Object.keys(chunk));
          console.log(`[Chunk #${count}] chunk.text:`, JSON.stringify(chunk.text));
          if (chunk.candidates) {
            chunk.candidates.forEach((c, idx) => {
              console.log(`  Cand[${idx}] finishReason:`, c.finishReason);
              if (c.content?.parts) {
                c.content.parts.forEach((p, pIdx) => {
                  console.log(`    Part[${pIdx}] keys:`, Object.keys(p), 'thought:', p.thought, 'textLen:', p.text?.length, 'text:', JSON.stringify(p.text));
                });
              }
            });
          }
          if (chunk.usageMetadata) console.log('  usageMetadata:', chunk.usageMetadata);
        }
        console.log('Streaming completed successfully with chunks:', count);
        break;
      } catch (e) {
        console.log(`Attempt #${attempt} failed:`, e.status, e.message);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    app.quit();
  }
});
