import 'server-only';

// Placeholder system prompt for E-040. E-043 will replace this with the
// v5b coach system prompt + graph-walk retrieval injection. Keeping this
// minimal here means we can verify the chat stack end-to-end without
// confounding it with any coaching behavior.
//
// The 'server-only' import above guarantees this string is not bundled
// into any client JS — the prompt is only visible inside route handlers.
export const SYSTEM_PROMPT = `You are a helpful coach. Help the user with whatever they bring.`;
