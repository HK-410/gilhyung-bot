import Groq from 'groq-sdk';
import { ChatCompletionCreateParamsNonStreaming } from 'groq-sdk/resources/chat/completions';

/**
 * A generic interface for the data structure expected from the LLM.
 * The calling application should define its own specific interface that extends this.
 */
export interface LlmResponse {
  [key: string]: any;
}

/**
 * Generates a response from the Groq API using a provided model.
 * @param systemPrompt The system prompt defining the AI's role and rules.
 * @param userPrompt The user prompt containing the specific request.
 * @param model The LLM model to use for the generation.
 * @param responseFormat The desired response format (e.g., { type: 'json_object' } or { type: 'text' }).
 * @returns A promise that resolves to the parsed JSON object of type T if 'json_object' is requested, otherwise a string.
 */
export async function generateGroqResponse<T extends LlmResponse>(
  systemPrompt: string, 
  userPrompt: string,
  model: string = 'openai/gpt-oss-120b',
  responseFormat?: Groq.Chat.Completions.CompletionCreateParams.ResponseFormatText | Groq.Chat.Completions.CompletionCreateParams.ResponseFormatJsonSchema | Groq.Chat.Completions.CompletionCreateParams.ResponseFormatJsonObject | null | undefined
): Promise<T | string> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY environment variable is not set.');
  }

  console.log(`Generating content with Groq API using model: ${model}...`);
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const completionParams: ChatCompletionCreateParamsNonStreaming = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    model: model,
    temperature: 0.75,
  };

  if (responseFormat) {
    completionParams.response_format = responseFormat;
  }

  const chatCompletion = await groq.chat.completions.create(completionParams);

  const generatedContent = chatCompletion.choices[0]?.message?.content;

  if (!generatedContent) {
    throw new Error('Groq API did not return any content.');
  }

  if (responseFormat?.type === 'json_object' || responseFormat?.type === 'json_schema') {
    try {
      const parsedJson = JSON.parse(generatedContent);
      return parsedJson as T;
    } catch (e: any) {
      console.error('Failed to parse LLM JSON response:', e.message);
      console.error('Raw LLM output:', generatedContent);
      throw new Error('LLM did not return a valid JSON object as requested.');
    }
  }

  return generatedContent;
}
