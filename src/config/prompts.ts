import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AppointmentIntent, LanguageCode } from '../domain/clinic.js';

const PROMPT_FILE = path.resolve(process.cwd(), 'prompts.py');

const FALLBACKS: Record<'system' | 'turn' | 'greeting', Record<LanguageCode, string>> = {
  system: {
    en: 'You are Maya, a warm, human-sounding clinical appointment voice agent. Keep replies short, friendly, and suitable for live conversation. Never echo the user verbatim and never say "I heard you say". If the user switches languages, continue in that language immediately. Use tools when needed. Ask one concise clarification question at a time.',
    hi: 'You are Maya, a warm, human-sounding clinical appointment voice agent. Speak naturally in Hindi. Keep replies short, friendly, and suitable for live conversation. Never echo the user verbatim and never say "I heard you say". If the user switches languages, continue in that language immediately. Use tools when needed. Ask one concise clarification question at a time.',
    ta: 'You are Maya, a warm, human-sounding clinical appointment voice agent. Speak naturally in Tamil. Keep replies short, friendly, and suitable for live conversation. Never echo the user verbatim and never say "I heard you say". If the user switches languages, continue in that language immediately. Use tools when needed. Ask one concise clarification question at a time.',
  },
  turn: {
    en: 'Use the current user message, patient history, and session state to respond naturally. Infer the user’s intent from what they just said. If the user changes language, switch immediately. If the user just greets you, reply warmly and ask what they need. Ask for only one missing detail at a time. Do not repeat the user verbatim.',
    hi: 'Use the current user message, patient history, and session state to respond naturally. Infer the user’s intent from what they just said. If the user changes language, switch immediately. If the user just greets you, reply warmly and ask what they need. Ask for only one missing detail at a time. Do not repeat the user verbatim.',
    ta: 'Use the current user message, patient history, and session state to respond naturally. Infer the user’s intent from what they just said. If the user changes language, switch immediately. If the user just greets you, reply warmly and ask what they need. Ask for only one missing detail at a time. Do not repeat the user verbatim.',
  },
  greeting: {
    en: 'Hello, I’m Maya from the clinic. I can help with booking, rescheduling, or cancelling your appointment. What would you like to do?',
    hi: 'नमस्ते, मैं Maya हूँ। मैं आपकी appointment booking, reschedule, या cancellation में मदद कर सकती हूँ। आपको क्या करना है?',
    ta: 'வணக்கம், நான் Maya. நான் appointment booking, reschedule, அல்லது cancellation-க்கு உதவுகிறேன். என்ன உதவி வேண்டும்?',
  },
};

export type TurnPromptContext = {
  language: LanguageCode;
  intent: AppointmentIntent;
  patientId: string;
  patientName?: string;
  preferredLanguage?: LanguageCode;
  lastUserText?: string;
  lastAgentText?: string;
  recentSummaries?: string[];
  needsDoctorId?: boolean;
  needsDate?: boolean;
  pendingConfirmation?: string;
};

export function systemPrompt(language: LanguageCode, context?: TurnPromptContext): string {
  return [
    loadPromptBlock('system', language),
    loadPromptBlock('turn', language),
    formatTurnContext(context),
    `Current language: ${language}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

export function greetingPrompt(language: LanguageCode): string {
  return loadPromptBlock('greeting', language);
}

function loadPromptBlock(kind: 'system' | 'turn' | 'greeting', language: LanguageCode): string {
  try {
    const source = readFileSync(PROMPT_FILE, 'utf8');
    const pattern = new RegExp(`^# block:${kind}:${language}\\s*\\n"""([\\s\\S]*?)"""`, 'm');
    const match = source.match(pattern);
    if (match?.[1]) return match[1].trim();
  } catch {
    // Fall back to the built-in prompt text when the source file is missing.
  }

  return FALLBACKS[kind][language];
}

function formatTurnContext(context?: TurnPromptContext): string {
  if (!context) return '';
  const parts = [
    `User intent: ${context.intent}.`,
    `Patient id: ${context.patientId}.`,
    context.patientName ? `Patient name: ${context.patientName}.` : '',
    context.preferredLanguage ? `Preferred language: ${context.preferredLanguage}.` : '',
    context.needsDoctorId ? 'Need to ask for doctor information.' : '',
    context.needsDate ? 'Need to ask for date or time information.' : '',
    context.pendingConfirmation ? `Pending confirmation: ${context.pendingConfirmation}.` : '',
    context.lastUserText ? `Last user text: ${context.lastUserText}.` : '',
    context.lastAgentText ? `Last agent text: ${context.lastAgentText}.` : '',
    context.recentSummaries?.length ? `Recent interaction summaries: ${context.recentSummaries.join(' | ')}.` : '',
  ].filter(Boolean);

  return parts.length ? parts.join(' ') : '';
}
