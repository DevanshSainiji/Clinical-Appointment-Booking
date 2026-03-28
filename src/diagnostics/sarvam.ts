import 'dotenv/config';
import { synthesizeSpeech } from '../services/tts.js';
import { transcribeAudio } from '../services/stt.js';
import { writeFile } from 'node:fs/promises';

async function main() {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    console.error('Missing SARVAM_API_KEY in environment.');
    process.exit(1);
  }

  const text = process.argv.slice(2).join(' ').trim() || 'Hello, this is Maya.';
  console.log('[diag:sarvam] TTS input:', JSON.stringify(text));

  const audio = await synthesizeSpeech(text, 'en');
  console.log('[diag:sarvam] TTS bytes:', audio.length);
  if (audio.length === 0) {
    console.error('[diag:sarvam] TTS returned empty audio.');
    process.exit(2);
  }

  const out = '/tmp/maya_sarvam_tts.wav';
  await writeFile(out, audio);
  console.log('[diag:sarvam] Wrote:', out);

  console.log('[diag:sarvam] Running STT on the generated audio (sanity check)...');
  const stt = await transcribeAudio(audio);
  console.log('[diag:sarvam] STT result:', stt);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

