const fs = require("fs");
const env = fs.readFileSync(".env.local", "utf8");
const match = env.match(/GEMINI_API_KEY=(.*)/);
const apiKey = match[1].trim();

fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${apiKey}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ parts: [{ text: "Hello" }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: "Algenib"
          }
        }
      }
    }
  })
}).then(r => r.json()).then(console.log).catch(console.error);
