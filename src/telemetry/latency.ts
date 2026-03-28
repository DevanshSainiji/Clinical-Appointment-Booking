type LatencyMark = {
  speechEndAt?: number;
  firstAudioByteAt?: number;
};

const marks = new Map<string, LatencyMark>();

export function markSpeechEnd(sessionId: string): void {
  const entry = marks.get(sessionId) || {};
  entry.speechEndAt = Date.now();
  marks.set(sessionId, entry);
}

export function markFirstAudioByte(sessionId: string): number | undefined {
  const entry = marks.get(sessionId);
  if (!entry?.speechEndAt) return undefined;
  entry.firstAudioByteAt = Date.now();
  return entry.firstAudioByteAt - entry.speechEndAt;
}

export function resetLatencyMarks(sessionId: string): void {
  marks.delete(sessionId);
}

