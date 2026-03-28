import 'dotenv/config';
import fs from 'fs';

async function test() {
  console.log("Testing Sarvam TTS with anushka...");
  const apiKey = process.env.SARVAM_API_KEY!;
  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 
      inputs: ["Hello there! This is Maya speaking."],
      target_language_code: "en-IN",
      speaker: "anushka",
      pitch: 0,
      pace: 1.1,
      loudness: 1.5,
      speech_sample_rate: 8000,
      enable_preprocessing: true,
      model: "bulbul:v1"
    }),
  });
  
  if (!response.ok) {
    console.log("Error:", await response.text());
    return;
  }
  const data = await response.json();
  const b64 = data.audios[0];
  const buffer = Buffer.from(b64, 'base64');
  console.log("Audio buffer length:", buffer.length);
  // Verify it starts with RIFF and WAVE
  console.log("Header:", buffer.toString('utf-8', 0, 12));
}

test();
