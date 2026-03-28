import { RESPONSE_PROMPT } from '../config/prompts.js';

export type GenerateResponseInput = {
  userText: string;
  intent: string;
  context: unknown;
  toolResult?: unknown;
  language: string;
};

export async function generateResponse(input: GenerateResponseInput): Promise<string> {
  const prompt = RESPONSE_PROMPT(input);
  const apiUrl = process.env.LLM_API_URL;
  const apiKey = process.env.LLM_API_KEY;

  if (!apiUrl) {
    // Local fallback keeps the flow runnable without external LLM credentials.
    return `(${input.language}) ${input.intent}: ${input.userText}`;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    throw new Error(`LLM request failed with status ${response.status}`);
  }

  const result = (await response.json()) as { text?: string };
  return result.text?.trim() || 'Sorry, I could not generate a response right now.';
}
