// Server-only: AI Copilot — personal opening lines and email copy (Gemini via Lovable AI Gateway).
import { jsonSchema, Output, streamText } from "ai";
import { COPILOT_MODEL, createGatewayProvider, toAiError } from "./ai-gateway.server";

export type LeadForLine = { id: string; first_name: string; last_name: string; company: string; designation: string; industry: string; custom_fields: Record<string, unknown> };

const LINE_RULES = `Write one personal opening line for a cold email to each person.
Rules: one sentence, 12-25 words, specific to their role, company or industry; sound like a real person who did a little homework;
no flattery clichés ("I hope this finds you well", "I came across your profile"), no exclamation marks, no made-up facts, numbers or news.
If you know little about them, write something true and modest about their role or industry. Do not include a greeting or their name at the start.`;

const linesSchema = jsonSchema<{ lines: { id: string; line: string }[] }>({
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: { type: "object", properties: { id: { type: "string" }, line: { type: "string" } }, required: ["id", "line"], additionalProperties: false },
    },
  },
  required: ["lines"],
  additionalProperties: false,
});

export async function generateLines(leads: LeadForLine[], context: string): Promise<Map<string, string>> {
  const provider = createGatewayProvider();
  const people = leads.map((l) => ({
    id: l.id,
    name: [l.first_name, l.last_name].filter(Boolean).join(" "),
    role: l.designation,
    company: l.company,
    industry: l.industry,
    notes: Object.entries(l.custom_fields ?? {}).slice(0, 8).map(([k, v]) => `${k}: ${String(v).slice(0, 200)}`).join("; "),
  }));
  try {
    const result = streamText({
      model: provider(COPILOT_MODEL),
      system: `${LINE_RULES}\n\nAbout the sender: ${context.trim() || "DECILE Media, a media and marketing agency."}`,
      prompt: `People (JSON):\n${JSON.stringify(people)}\n\nReturn one line for every id.`,
      output: Output.object({ schema: linesSchema }),
      maxRetries: 0,
    });
    const out = await result.output;
    const ids = new Set(leads.map((l) => l.id));
    return new Map(out.lines.filter((x) => ids.has(x.id) && x.line.trim()).map((x) => [x.id, x.line.trim().slice(0, 400)]));
  } catch (e) {
    throw toAiError(e);
  }
}

const copySchema = jsonSchema<{ subject: string; body: string }>({
  type: "object",
  properties: { subject: { type: "string" }, body: { type: "string" } },
  required: ["subject", "body"],
  additionalProperties: false,
});

export async function writeCopy(input: { brief: string; kind: "email" | "follow_up" | "reply"; tone: string; context: string }) {
  const provider = createGatewayProvider();
  const kindText =
    input.kind === "follow_up"
      ? "a short follow-up (40-80 words) sent in the same thread to someone who hasn't replied; subject can be empty"
      : input.kind === "reply"
        ? "a reply to a prospect's message"
        : "a first cold email (60-130 words) with a short, lower-case-friendly subject (2-6 words)";
  try {
    const result = streamText({
      model: provider(COPILOT_MODEL),
      system: `You write B2B outreach emails that read like a note from one person to another. Write ${kindText}.
Use plain text. You may use these placeholders: {{first_name|there}}, {{company}}, {{designation}}, {{industry}}, {{ai_line}} (a personal opening line written per person).
No sign-off name (a signature is added automatically), no links unless the brief asks, no sales clichés, no exclamation marks in the subject.
Tone: ${input.tone || "warm, direct, concise"}.
About the sender: ${input.context.trim() || "DECILE Media, a media and marketing agency."}`,
      prompt: input.brief,
      output: Output.object({ schema: copySchema }),
      maxRetries: 0,
    });
    const out = await result.output;
    return { subject: out.subject.trim().slice(0, 200), body: out.body.trim().slice(0, 6000) };
  } catch (e) {
    throw toAiError(e);
  }
}
