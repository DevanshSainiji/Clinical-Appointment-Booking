export type ReasoningTrace = {
  intent: string;
  language: 'en' | 'hi' | 'ta';
  toolCalls: string[];
  responseText: string;
  timestampIso: string;
};

const traceBuffer: ReasoningTrace[] = [];

export function recordReasoningTrace(trace: ReasoningTrace): void {
  traceBuffer.push(trace);
}

export function getReasoningTraces(): ReasoningTrace[] {
  return traceBuffer;
}
