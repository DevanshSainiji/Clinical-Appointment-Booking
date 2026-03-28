import { GoogleGenerativeAI, type ChatSession, type FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { appendAppointmentHistory } from '../memory/longTermMemory.js';
import { getPatientProfile } from '../tools/getPatientProfile.js';
import { getScheduleOptions } from '../tools/getScheduleOptions.js';
import { manageAppointment, type AppointmentAction } from '../tools/manageAppointment.js';
import { recordReasoningTrace } from '../telemetry/traces.js';

export type LanguageCode = "en" | "hi" | "ta";

export type OrchestrationInput = {
  sessionId: string;
  patientId: string;
  userText: string;
  language?: string;
};

export type OrchestrationResult = {
  responseText: string;
  language: LanguageCode;
};

const getPatientProfileDecl: FunctionDeclaration = {
  name: "getPatientProfile",
  description: "Get the profile and historical interactions of the patient.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      patientId: { type: SchemaType.STRING, description: "The ID of the patient" }
    },
    required: ["patientId"]
  }
};

const getScheduleOptionsDecl: FunctionDeclaration = {
  name: "getScheduleOptions",
  description: "Get available time slots for clinical appointments.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      patientId: { type: SchemaType.STRING }
    },
    required: ["patientId"]
  }
};

const manageAppointmentDecl: FunctionDeclaration = {
  name: "manageAppointment",
  description: "Book, reschedule, or cancel a clinical appointment.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      action: { type: SchemaType.STRING, description: "The action to perform, must be one of: book, reschedule, cancel" },
      patientId: { type: SchemaType.STRING, description: "The patient ID" },
      slotId: { type: SchemaType.STRING, description: "Required for book/reschedule. The slot ID." }
    },
    required: ["action", "patientId"]
  }
};

const activeSessions = new Map<string, ChatSession>();

function getGenAIModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing in your .env");
  
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    tools: [{ functionDeclarations: [getPatientProfileDecl, getScheduleOptionsDecl, manageAppointmentDecl] }],
    systemInstruction: "You are a highly efficient clinical appointment booking voice agent. Keep your responses conversational but brief as this is voice. Use your tools to check patient profiles, find schedule options, and manage appointments. Follow the user's lead on language."
  });
}

function normalizeLanguage(lang?: string): LanguageCode {
  if (lang === 'hi' || lang === 'ta') return lang;
  return 'en';
}

export async function runOrchestrationTurn(input: OrchestrationInput): Promise<OrchestrationResult> {
  let chat = activeSessions.get(input.sessionId);
  let justCreated = false;
  const lang = normalizeLanguage(input.language);

  if (!chat) {
    const model = getGenAIModel();
    chat = model.startChat();
    activeSessions.set(input.sessionId, chat);
    justCreated = true;
  }

  if (justCreated) {
    const profile = await getPatientProfile(input.patientId);
    await chat.sendMessage(`(System Notification) The patient ID is ${input.patientId}, Name: ${profile.name}. Known language: ${profile.preferredLanguage}. Start processing the user's following prompt.`);
  }

  const result = await chat.sendMessage(input.userText);
  let responseText = "";
  const toolCallsMade: string[] = [];

  const functionCalls = result.response.functionCalls();
  if (functionCalls && functionCalls.length > 0) {
    for (const call of functionCalls) {
      toolCallsMade.push(call.name);
      let functionResult: any = null;
      const args = call.args as Record<string, any>;

      if (call.name === "getPatientProfile") {
        functionResult = await getPatientProfile(args.patientId as string);
      } else if (call.name === "getScheduleOptions") {
        functionResult = await getScheduleOptions({ patientId: args.patientId as string });
      } else if (call.name === "manageAppointment") {
        functionResult = await manageAppointment({
          action: args.action as AppointmentAction,
          patientId: args.patientId as string,
          slotId: args.slotId as string | undefined
        });
      }

      const secondResult = await chat.sendMessage([{
        functionResponse: {
          name: call.name,
          response: functionResult ?? { ok: false, message: "Unknown tool failure" }
        }
      }]);
      responseText = secondResult.response.text();
    }
  } else {
    responseText = result.response.text();
  }

  recordReasoningTrace({
    intent: "LLM Orchestrated",
    language: lang,
    toolCalls: toolCallsMade,
    responseText,
    timestampIso: new Date().toISOString(),
  });

  if (toolCallsMade.includes("manageAppointment")) {
    await appendAppointmentHistory({
      patientId: input.patientId,
      summary: responseText,
      createdAtIso: new Date().toISOString(),
    });
  }

  return {
    responseText,
    language: lang
  };
}
