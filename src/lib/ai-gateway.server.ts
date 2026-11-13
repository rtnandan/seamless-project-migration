// Server-only: Lovable AI Gateway provider for Chat Completions models (Gemini).
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createLovableAiGatewayRunIdFetch } from "./ai-run-id.server";

export const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
/** The user asked for Gemini for copy and personal lines. */
export const COPILOT_MODEL = "google/gemini-3.8-flash";

export class AiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function createGatewayProvider() {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new AiError("AI isn't set up on the server yet.", 401);
  const runIdFetch = createLovableAiGatewayRunIdFetch(undefined);
  return createOpenAICompatible({
    name: "lovable",
    baseURL: GATEWAY_URL,
    supportsStructuredOutputs: true,
    headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });
}

/** Turns gateway failures into a plain message (credits, rate limits, etc.). */
export function toAiError(e: unknown): AiError {
  const status = Number((e as { statusCode?: number }).statusCode ?? (e as { status?: number }).status ?? 0);
  const raw = String((e as { responseBody?: string }).responseBody ?? (e as Error)?.message ?? e);
  let msg = raw;
  try {
    const j = JSON.parse(raw) as { message?: string; error?: { message?: string } };
    msg = j.message ?? j.error?.message ?? raw;
  } catch {
    /* plain text */
  }
  if (status === 402) return new AiError(msg || "AI credits have run out for this workspace.", 402);
  if (status === 429) return new AiError("The AI is busy right now. Try again in a minute.", 429);
  return new AiError(`AI request failed${status ? ` [${status}]` : ""}: ${msg.slice(0, 300)}`, status);
}
