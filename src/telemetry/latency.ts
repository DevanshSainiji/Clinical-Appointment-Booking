type LatencyMark = {
  speechEndMs?: number;
  firstAudioByteMs?: number;
};

const marks: LatencyMark = {};

export function markSpeechEnd(nowMs: number): void {
  marks.speechEndMs = nowMs;
}

export function markFirstAudioByte(nowMs: number): void {
  marks.firstAudioByteMs = nowMs;
}

export function getEndToEndLatencyMs(): number | null {
  if (marks.speechEndMs == null || marks.firstAudioByteMs == null) {
    return null;
  }
  return marks.firstAudioByteMs - marks.speechEndMs;
}

export function resetLatencyMarks(): void {
  marks.speechEndMs = undefined;
  marks.firstAudioByteMs = undefined;
}
