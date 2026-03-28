import { systemPrompt } from '../config/prompts.js';
import type {
  AppointmentIntent,
  LanguageCode,
  AppointmentSlot,
  ScheduleOption,
  ToolResult,
} from '../domain/clinic.js';
import { buildDialogueState } from './dialogueManager.js';
import { detectLanguage, routeIntent } from './intentRouter.js';
import { parseAppointmentRequest, type DoctorRef } from './requestParser.js';
import { getPatientProfileTool } from '../tools/getPatientProfile.js';
import { getScheduleOptionsTool } from '../tools/getScheduleOptions.js';
import { manageAppointmentTool, type AppointmentAction } from '../tools/manageAppointment.js';
import { appendInteractionSummary, getInteractionSummaries, getPatientProfile, setPreferredLanguage } from '../memory/longTermMemory.js';
import { loadStore } from '../storage/clinicStore.js';
import { updateSessionMemory } from '../memory/sessionMemory.js';
import { recordReasoningTrace } from '../telemetry/traces.js';
import { logger } from '../telemetry/logger.js';

export type OrchestrationInput = {
  sessionId: string;
  patientId: string;
  userText: string;
  normalizedUserText?: string;
  language?: string;
};

export type OrchestrationResult = {
  responseText: string;
  language: LanguageCode;
  toolCalls: Array<{ name: string; input: unknown; result: unknown }>;
  intent: AppointmentIntent;
};

type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

type AnthropicMessage = {
  role: 'assistant' | 'user';
  content: AnthropicContent[];
};

export async function runOrchestrationTurn(input: OrchestrationInput): Promise<OrchestrationResult> {
  logger.info('orchestrator', 'turn_start', {
    sessionId: input.sessionId,
    patientId: input.patientId,
    textPreview: input.userText.slice(0, 200),
    normalizedPreview: input.normalizedUserText?.slice(0, 200) || null,
    languageHint: input.language || null,
  });
  const store = await loadStore();
  const knownDoctors = collectKnownDoctors(store.slots);
  const routed = routeIntent(input.normalizedUserText || input.userText, input.language);
  logger.debug('orchestrator', 'intent_routed', {
    sessionId: input.sessionId,
    patientId: input.patientId,
    intent: routed.intent,
    language: routed.language,
    confidence: routed.confidence,
  });
  const profile = await getPatientProfile(input.patientId);
  logger.debug('orchestrator', 'profile_loaded', {
    sessionId: input.sessionId,
    patientId: input.patientId,
    preferredLanguage: profile.preferredLanguage,
    preferredDoctorId: profile.preferredDoctorId || null,
  });
  const turnLanguage = routed.language;
  const dialogue = await buildDialogueState(
    input.sessionId,
    input.patientId,
    routed.intent,
    turnLanguage,
    input.userText,
    input.normalizedUserText || input.userText,
  );

  const request = parseAppointmentRequest(input.normalizedUserText || input.userText, turnLanguage, knownDoctors);
  const conversationLanguage = chooseConversationLanguage(turnLanguage, request.language);
  const resolvedIntent = resolveIntent(dialogue.intent, request, dialogue);

  if (profile.preferredLanguage !== conversationLanguage) {
    await setPreferredLanguage(input.patientId, conversationLanguage);
  }

  logger.debug('orchestrator', 'dialogue_state', {
    sessionId: input.sessionId,
    patientId: input.patientId,
    intent: resolvedIntent,
    language: conversationLanguage,
    needsDoctorId: dialogue.needsDoctorId,
    needsDate: dialogue.needsDate,
    pendingConfirmation: dialogue.pendingConfirmation || null,
    parsedDoctorId: request.doctorId || null,
    parsedDateIso: request.dateIso || null,
  });

  await updateSessionMemory(input.sessionId, {
    patientId: input.patientId,
    intent: resolvedIntent,
    language: conversationLanguage,
    lastUserText: input.userText,
    lastNormalizedText: input.normalizedUserText || input.userText,
    pendingDoctorId: request.doctorId || undefined,
    pendingDoctorName: request.doctorName || undefined,
    pendingDateIso: request.dateIso || undefined,
    pendingDateLabel: request.dateLabel || undefined,
    slotDoctorProvided: Boolean(request.doctorId) || dialogue.needsDoctorId === false,
    slotDateProvided: Boolean(request.dateIso) || dialogue.needsDate === false,
  });

  const toolCalls: Array<{ name: string; input: unknown; result: unknown }> = [];
  const recentSummaries = await getInteractionSummaries(input.patientId);
  const system = systemPrompt(conversationLanguage, {
    language: conversationLanguage,
    intent: resolvedIntent,
    patientId: input.patientId,
    patientName: profile.name,
    preferredLanguage: profile.preferredLanguage,
    lastUserText: dialogue.lastUserText,
    lastAgentText: dialogue.lastAgentText,
    recentSummaries: recentSummaries.map((item) => item.summary).slice(0, 3),
    needsDoctorId: dialogue.needsDoctorId,
    needsDate: dialogue.needsDate,
    pendingConfirmation: dialogue.pendingConfirmation,
  });
  const messages: AnthropicMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            `Patient profile: ${JSON.stringify(profile)}`,
            `Session state: ${JSON.stringify(dialogue)}`,
            `Recent summaries: ${JSON.stringify(recentSummaries.slice(0, 3))}`,
            `User original message: ${input.userText}`,
            input.normalizedUserText ? `User normalized message: ${input.normalizedUserText}` : '',
            `Detected intent: ${resolvedIntent}`,
            `Detected language: ${conversationLanguage}`,
            `Parsed doctor: ${request.doctorName || request.doctorId || ''}`,
            `Parsed date: ${request.dateIso || request.dateLabel || ''}`,
            'Respond in the user’s current language, adapt your tone to be human-friendly, and use tools only when they help move the appointment forward.',
          ].join('\n'),
        },
      ],
    },
  ];

  const finalText = await runAnthropicToolLoop(system, messages, toolCalls, {
    sessionId: input.sessionId,
    patientId: input.patientId,
    profile,
    dialogue,
    request,
    language: conversationLanguage,
    recentSummaries,
    normalizedText: input.normalizedUserText || input.userText,
  });
  const responseText = finalText.trim() || fallbackResponse(resolvedIntent, conversationLanguage);
  logger.info('orchestrator', 'turn_complete', {
    sessionId: input.sessionId,
    patientId: input.patientId,
    intent: resolvedIntent,
    language: conversationLanguage,
    toolCalls: toolCalls.map((tool) => tool.name),
    responsePreview: responseText.slice(0, 200),
  });

  await appendInteractionSummary({
    patientId: input.patientId,
    sessionId: input.sessionId,
    summary: responseText,
    language: conversationLanguage,
    createdAtIso: new Date().toISOString(),
  });

  await recordReasoningTrace({
    sessionId: input.sessionId,
    patientId: input.patientId,
    language: conversationLanguage,
    intent: resolvedIntent,
    toolCalls,
    responseText,
    timestampIso: new Date().toISOString(),
  });

  return {
    responseText,
    language: conversationLanguage,
    toolCalls,
    intent: resolvedIntent,
  };
}

type LocalPlannerContext = {
  sessionId: string;
  patientId: string;
  profile: Awaited<ReturnType<typeof getPatientProfile>>;
  dialogue: Awaited<ReturnType<typeof buildDialogueState>>;
  request: ReturnType<typeof parseAppointmentRequest>;
  language: LanguageCode;
  recentSummaries: { summary: string }[];
  normalizedText: string;
};

async function runAnthropicToolLoop(
  system: string,
  messages: AnthropicMessage[],
  toolCalls: Array<{ name: string; input: unknown; result: unknown }>,
  context: LocalPlannerContext,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn('orchestrator', 'llm_missing', { provider: 'anthropic', fallback: 'local' });
    return runLocalPlanner(context, toolCalls);
  }

  const tools = [
    {
      name: 'getPatientProfile',
      description: 'Load patient profile and recent interactions.',
      input_schema: {
        type: 'object',
        properties: { patientId: { type: 'string' } },
        required: ['patientId'],
      },
    },
    {
      name: 'getScheduleOptions',
      description: 'Fetch available appointment slots for a patient and doctor/date criteria.',
      input_schema: {
        type: 'object',
        properties: {
          patientId: { type: 'string' },
          doctorId: { type: 'string' },
          dateIso: { type: 'string' },
          intent: { type: 'string' },
        },
        required: ['patientId'],
      },
    },
    {
      name: 'manageAppointment',
      description: 'Book, reschedule, or cancel an appointment.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          patientId: { type: 'string' },
          slotId: { type: 'string' },
          language: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['action', 'patientId'],
      },
    },
  ];

  let currentMessages = messages.slice();
  for (let round = 0; round < 3; round++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
        max_tokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '700', 10),
        temperature: Number(process.env.ANTHROPIC_TEMPERATURE || '0.2'),
        system,
        tools,
        messages: currentMessages,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn('orchestrator', 'llm_unavailable', {
        status: response.status,
        bodyPreview: text.slice(0, 300),
      });
      return runLocalPlanner(context, toolCalls);
    }

    const payload = (await response.json()) as { content?: AnthropicContent[] };
    const content = payload.content ?? [];
    const toolUses = content.filter((part): part is Extract<AnthropicContent, { type: 'tool_use' }> => part.type === 'tool_use');
    const textParts = content.filter((part): part is Extract<AnthropicContent, { type: 'text' }> => part.type === 'text');
    const text = textParts.map((part) => part.text).join('\n').trim();

    logger.debug('orchestrator', 'llm_round', {
      toolUses: toolUses.map((tool) => tool.name),
      textPreview: text.slice(0, 200),
    });

    if (!toolUses.length) {
      return text;
    }

    const assistantBlocks: AnthropicContent[] = content;
    currentMessages = [
      ...currentMessages,
      {
        role: 'assistant',
        content: assistantBlocks,
      },
    ];

    const toolResults: AnthropicContent[] = [];
    for (const tool of toolUses) {
      const result = await executeTool(tool.name, tool.input);
      toolCalls.push({ name: tool.name, input: tool.input, result });
      logger.info('orchestrator', 'tool_executed', {
        tool: tool.name,
        input: tool.input,
        result,
      });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tool.id,
        content: JSON.stringify(result),
      });
    }

    currentMessages = [
      ...currentMessages,
      {
        role: 'user',
        content: toolResults,
      },
    ];

  }

  return runLocalPlanner(context, toolCalls);
}

async function executeTool(name: string, input: Record<string, any>): Promise<ToolResult> {
  logger.debug('orchestrator', 'execute_tool', { name, input });
  if (name === 'getPatientProfile') return getPatientProfileTool({ patientId: String(input.patientId || '') });
  if (name === 'getScheduleOptions') {
    return getScheduleOptionsTool({
      patientId: String(input.patientId || ''),
      doctorId: input.doctorId ? String(input.doctorId) : undefined,
      dateIso: input.dateIso ? String(input.dateIso) : undefined,
      intent: input.intent as AppointmentIntent | undefined,
      language: 'en',
    });
  }
  if (name === 'manageAppointment') {
    return manageAppointmentTool({
      action: String(input.action) as AppointmentAction,
      patientId: String(input.patientId || ''),
      slotId: input.slotId ? String(input.slotId) : undefined,
      language: input.language === 'hi' || input.language === 'ta' ? input.language : 'en',
      note: input.note ? String(input.note) : undefined,
    });
  }
  return { ok: false, message: `Unknown tool: ${name}` };
}

function fallbackResponse(intent: AppointmentIntent, language: LanguageCode): string {
  logger.debug('orchestrator', 'fallback_response', { intent, language });
  const byLanguage: Record<LanguageCode, Record<AppointmentIntent, string>> = {
    en: {
      book: 'I can help book that. Tell me the doctor or preferred date.',
      reschedule: 'I can reschedule that. Share the appointment or the new slot you want.',
      cancel: 'I can cancel that appointment. Which one should I cancel?',
      campaign: 'I can handle the reminder campaign. Tell me who to contact.',
      unknown: 'How can I help with your appointment today?',
    },
    hi: {
      book: 'मैं बुकिंग में मदद कर सकती हूँ। डॉक्टर या तारीख बताइए।',
      reschedule: 'मैं री-शेड्यूल कर सकती हूँ। पुराना या नया स्लॉट बताइए।',
      cancel: 'मैं अपॉइंटमेंट कैंसल कर सकती हूँ। कौन-सा अपॉइंटमेंट?',
      campaign: 'मैं रिमाइंडर कैंपेन संभाल सकती हूँ। किसे संपर्क करना है?',
      unknown: 'अपॉइंटमेंट में मैं आपकी कैसे मदद करूँ?',
    },
    ta: {
      book: 'நான் booking-க்கு உதவுகிறேன். மருத்துவர் அல்லது தேதியை சொல்லுங்கள்.',
      reschedule: 'நான் reschedule செய்யலாம். பழைய appointment அல்லது புதிய slot சொல்லுங்கள்.',
      cancel: 'நான் அந்த appointment-ஐ cancel செய்யலாம். எது என்று சொல்லுங்கள்.',
      campaign: 'நான் reminder campaign-ஐ கையாளலாம். யாரை தொடர்பு கொள்ள வேண்டும்?',
      unknown: 'Appointment பற்றி எப்படி உதவ வேண்டும்?',
    },
  };

  return byLanguage[language][intent];
}

async function runLocalPlanner(context: LocalPlannerContext, toolCalls: Array<{ name: string; input: unknown; result: unknown }>): Promise<string> {
  const { profile, dialogue, request, language, patientId, sessionId, normalizedText } = context;
  const session = await updateOrCreateSessionSnapshot(sessionId);
  const intent = resolveIntent(dialogue.intent, request, dialogue);

  logger.debug('orchestrator', 'local_planner_start', {
    sessionId,
    patientId,
    intent,
    language,
    dateIso: request.dateIso || null,
    doctorId: request.doctorId || null,
  });

  if (intent === 'cancel') {
    const result = await manageAppointmentTool({ action: 'cancel', patientId, language });
    toolCalls.push({ name: 'manageAppointment', input: { action: 'cancel', patientId, language }, result });
    return localResponseFromToolResult(result, language, 'cancel');
  }

  if (intent === 'reschedule' || intent === 'book') {
    const pendingDoctor = request.doctorId || session.pendingDoctorId || profile.preferredDoctorId;
    const pendingDate = request.dateIso || session.pendingDateIso;

    await updateSessionMemory(sessionId, {
      patientId,
      intent,
      language,
      lastUserText: context.normalizedText,
      lastNormalizedText: context.normalizedText,
      pendingDoctorId: request.doctorId || session.pendingDoctorId || undefined,
      pendingDoctorName: request.doctorName || session.pendingDoctorName || undefined,
      pendingDateIso: request.dateIso || session.pendingDateIso || undefined,
      pendingDateLabel: request.dateLabel || session.pendingDateLabel || undefined,
      slotDoctorProvided: Boolean(pendingDoctor),
      slotDateProvided: Boolean(pendingDate),
    });

    if (!pendingDate && !pendingDoctor) {
      return askForMissingDetails(language, 'both');
    }
    if (!pendingDate) {
      return askForMissingDetails(language, 'date');
    }
    if (!pendingDoctor) {
      return askForMissingDetails(language, 'doctor');
    }

    const schedule = await getScheduleOptionsTool({
      patientId,
      doctorId: pendingDoctor,
      dateIso: pendingDate,
      intent,
      language,
    });
    toolCalls.push({
      name: 'getScheduleOptions',
      input: { patientId, doctorId: pendingDoctor, dateIso: pendingDate, intent, language },
      result: schedule,
    });

    const options = (schedule.ok && schedule.data && typeof schedule.data === 'object'
      ? (schedule.data as { options?: ScheduleOption[] }).options || []
      : []) as ScheduleOption[];

    if (!options.length) {
      const alternatives = await getScheduleOptionsTool({
        patientId,
        dateIso: pendingDate,
        intent,
        language,
      });
      toolCalls.push({
        name: 'getScheduleOptions',
        input: { patientId, dateIso: pendingDate, intent, language },
        result: alternatives,
      });

      const altOptions = (alternatives.ok && alternatives.data && typeof alternatives.data === 'object'
        ? (alternatives.data as { options?: ScheduleOption[] }).options || []
        : []) as ScheduleOption[];

      if (!altOptions.length) {
        return noSlotsResponse(language, request.dateLabel || pendingDate);
      }

      const chosen = altOptions[0];
      const booked = await manageAppointmentTool({
        action: intent === 'reschedule' ? 'reschedule' : 'book',
        patientId,
        slotId: chosen.slotId,
        language,
        note: normalizedText,
      });
      toolCalls.push({
        name: 'manageAppointment',
        input: { action: intent, patientId, slotId: chosen.slotId, language, note: normalizedText },
        result: booked,
      });
      return bookingResponse(language, intent, chosen, booked);
    }

    const chosen = options[0];
    const booked = await manageAppointmentTool({
      action: intent === 'reschedule' ? 'reschedule' : 'book',
      patientId,
      slotId: chosen.slotId,
      language,
      note: normalizedText,
    });
    toolCalls.push({
      name: 'manageAppointment',
      input: { action: intent, patientId, slotId: chosen.slotId, language, note: normalizedText },
      result: booked,
    });
    return bookingResponse(language, intent, chosen, booked);
  }

  if (isGreetingText(normalizedText)) {
    return fallbackResponse('unknown', language);
  }

  return askForMissingDetails(language, 'both');
}

async function updateOrCreateSessionSnapshot(sessionId: string) {
  const store = await loadStore();
  return store.sessions.find((session) => session.sessionId === sessionId) || {
    sessionId,
    patientId: sessionId.split(':')[1] || sessionId,
    intent: 'unknown' as AppointmentIntent,
    language: 'en' as LanguageCode,
    updatedAtIso: new Date().toISOString(),
  };
}

function resolveIntent(
  dialogueIntent: AppointmentIntent,
  request: ReturnType<typeof parseAppointmentRequest>,
  dialogue: Awaited<ReturnType<typeof buildDialogueState>>,
): AppointmentIntent {
  if (request.hasCancellationCue) return 'cancel';
  if (request.hasRescheduleCue) return 'reschedule';
  if (request.hasBookingCue || request.dateIso || request.doctorId) return dialogueIntent === 'unknown' ? 'book' : dialogueIntent;
  return dialogueIntent !== 'unknown' ? dialogueIntent : request.dateIso || request.doctorId ? 'book' : 'unknown';
}

function chooseConversationLanguage(turnLanguage: LanguageCode, requestLanguage: LanguageCode): LanguageCode {
  if (requestLanguage !== 'en') return requestLanguage;
  if (turnLanguage !== 'en') return turnLanguage;
  return 'en';
}

function collectKnownDoctors(slots: AppointmentSlot[]): DoctorRef[] {
  const seen = new Map<string, DoctorRef>();
  for (const slot of slots) {
    if (!seen.has(slot.doctorId)) {
      seen.set(slot.doctorId, { doctorId: slot.doctorId, doctorName: slot.doctorName });
    }
  }
  return [...seen.values()];
}

function askForMissingDetails(language: LanguageCode, missing: 'date' | 'doctor' | 'both'): string {
  const messages = {
    en: {
      date: 'Which date would you like?',
      doctor: 'Which doctor would you like to book with?',
      both: 'Which doctor and date would you like for the appointment?',
    },
    hi: {
      date: 'आप किस तारीख़ के लिए बुक करना चाहेंगे?',
      doctor: 'किस डॉक्टर के साथ अपॉइंटमेंट बुक करना है?',
      both: 'किस डॉक्टर और किस तारीख़ के लिए अपॉइंटमेंट चाहिए?',
    },
    ta: {
      date: 'எந்த தேதிக்கு appointment வேண்டும்?',
      doctor: 'எந்த மருத்துவருடன் appointment வேண்டும்?',
      both: 'எந்த மருத்துவர் மற்றும் எந்த தேதிக்கு appointment வேண்டும்?',
    },
  };
  return messages[language][missing];
}

function noSlotsResponse(language: LanguageCode, dateLabel: string): string {
  const messages = {
    en: `I couldn’t find an available slot for ${dateLabel}. I can try a different time or doctor.`,
    hi: `${dateLabel} के लिए कोई स्लॉट नहीं मिला। मैं दूसरा समय या डॉक्टर देख सकती हूँ।`,
    ta: `${dateLabel}-க்கு கிடைக்கக்கூடிய slot இல்லை. வேறு நேரம் அல்லது மருத்துவரை பார்க்கலாம்.`,
  };
  return messages[language];
}

function bookingResponse(language: LanguageCode, intent: AppointmentIntent, option: ScheduleOption, result: ToolResult): string {
  if (!result.ok) {
    return localErrorResponse(language, result.message);
  }

  const dateText = formatDateTime(option.startsAtIso, language);
  const actionText = intent === 'reschedule' ? 'rescheduled' : 'booked';
  const messages = {
    en: `Done. I’ve ${actionText} your appointment with ${option.doctorName} for ${dateText}.`,
    hi: `हो गया। मैंने आपका अपॉइंटमेंट ${option.doctorName} के साथ ${dateText} के लिए बुक कर दिया है।`,
    ta: `சரி. நான் ${option.doctorName} உடன் ${dateText}க்கு appointment-ஐ ${intent === 'reschedule' ? 'மாற்றி வைத்துள்ளேன்' : 'book செய்துள்ளேன்'}.`,
  };
  return messages[language];
}

function localResponseFromToolResult(result: ToolResult, language: LanguageCode, action: 'cancel'): string {
  if (!result.ok) return localErrorResponse(language, result.message);
  const messages = {
    en: 'Done. Your appointment has been cancelled.',
    hi: 'हो गया। आपका अपॉइंटमेंट कैंसल कर दिया गया है।',
    ta: 'சரி. உங்கள் appointment ரத்து செய்யப்பட்டுள்ளது.',
  };
  return messages[language];
}

function localErrorResponse(language: LanguageCode, detail: string): string {
  const messages = {
    en: `I ran into a problem: ${detail}`,
    hi: `एक समस्या आई: ${detail}`,
    ta: `ஒரு சிக்கல் ஏற்பட்டது: ${detail}`,
  };
  return messages[language];
}

function formatDateTime(startsAtIso: string, language: LanguageCode): string {
  const locale = language === 'hi' ? 'hi-IN' : language === 'ta' ? 'ta-IN' : 'en-IN';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(startsAtIso));
}

function isGreetingText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(hi|hello|hey|hii+|namaste|namaskar|vanakkam|வணக்கம்|नमस्ते|hola|bonjour)([\s!.?]*)$/.test(normalized);
}
