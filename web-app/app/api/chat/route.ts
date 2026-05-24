import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { openrouter, DEFAULT_COACH_MODEL } from '@/app/lib/openrouter';
import { SYSTEM_PROMPT } from '@/app/lib/system-prompt';

// Node runtime explicitly — not edge. The OpenRouter provider works on edge
// too, but later experiments (E-043) will lift coach-app code that uses
// Node-native fs and path. Picking Node now avoids a runtime swap later.
export const runtime = 'nodejs';

// Allow the model to stream up to 30s. The default route timeout in Next.js
// dev is short enough that long generations get cut off without this.
export const maxDuration = 30;

type ChatRequestBody = {
  messages: UIMessage[];
};

export async function POST(req: Request): Promise<Response> {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  if (!Array.isArray(body.messages)) {
    return new Response('messages must be an array', { status: 400 });
  }

  // useChat sends UIMessage[]; streamText needs ModelMessage[]. The convert
  // helper handles all the part-type translation (text parts, tool calls,
  // tool results, attachments) so the route handler never has to look inside
  // the parts array. The conversion is async in AI SDK v6 because file/image
  // parts may need fetching.
  const modelMessages = await convertToModelMessages(body.messages);

  const result = streamText({
    model: openrouter(DEFAULT_COACH_MODEL),
    system: SYSTEM_PROMPT,
    messages: modelMessages,
  });

  // toUIMessageStreamResponse encodes the AI SDK v6 UI stream format that
  // useChat consumes on the client. It serializes text deltas, tool calls,
  // tool results, and any custom data parts together so they render in the
  // right order.
  return result.toUIMessageStreamResponse();
}
