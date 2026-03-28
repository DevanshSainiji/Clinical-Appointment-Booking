import type { LanguageCode } from '../orchestration/orchestrator.js';

export async function synthesizeSpeech(text: string, language: LanguageCode): Promise<Uint8Array> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    console.warn("No SARVAM_API_KEY available for TTS.");
    return new Uint8Array();
  }

  const targetCode = language === 'hi' ? 'hi-IN' : (language === 'ta' ? 'ta-IN' : 'en-IN');
  
  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: [text],
      target_language_code: targetCode,
      speaker: language === 'en' ? "anushka" : "amartya",
      pitch: 0,
      pace: 1.0,
      loudness: 1.5,
      speech_sample_rate: 8000,
      enable_preprocessing: true,
      model: "bulbul:v3"
    }),
  });

  if (response.ok) {
    const data = await response.json();
    if (data.audios && data.audios.length > 0) {
      const b64 = data.audios[0];
      return Buffer.from(b64, 'base64');
    }
  } else {
    console.error("Sarvam TTS returned an error status:", response.status, await response.text());
  }

  return new Uint8Array();
}
