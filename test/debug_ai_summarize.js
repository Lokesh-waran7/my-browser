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

    console.log('Testing "summarize" prompt to see thought parts and stream structure:');
    const streamRes = await client.models.generateContentStream({
      model,
      contents: [{
        role: 'user',
        parts: [{ text: 'Please summarize: The quick brown fox jumps over the lazy dog. Provide 3 bullet points with deep analysis.' }]
      }],
    });

    let count = 0;
    for await (const chunk of streamRes) {
      count++;
      console.log(`\n--- Chunk #${count} ---`);
      console.log('chunk.text:', JSON.stringify(chunk.text));
      if (chunk.candidates) {
        chunk.candidates.forEach((c, idx) => {
          console.log(`Cand[${idx}] finishReason: ${c.finishReason}`);
          if (c.content?.parts) {
            c.content.parts.forEach((p, pIdx) => {
              console.log(`  Part[${pIdx}]: thought=${p.thought}, textLen=${p.text?.length}, snippet=${JSON.stringify(p.text ? p.text.slice(0, 50) : '')}`);
            });
          }
        });
      }
    }
    console.log('\nTotal chunks:', count);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    app.quit();
  }
});
