import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ReasoningTrace = {
  sessionId: string;
  patientId: string;
  language: 'en' | 'hi' | 'ta';
  intent: string;
  toolCalls: Array<{ name: string; input: unknown; result: unknown }>;
  responseText: string;
  timestampIso: string;
  ttfbMs?: number;
};

const traces: ReasoningTrace[] = [];
const traceFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/reasoning-traces.ndjson');

export async function recordReasoningTrace(trace: ReasoningTrace): Promise<void> {
  traces.unshift(trace);
  traces.splice(1000);
  await appendFile(traceFile, `${JSON.stringify(trace)}\n`, 'utf8').catch(() => {});
}

export function getReasoningTraces(): ReasoningTrace[] {
  return traces.slice();
}

