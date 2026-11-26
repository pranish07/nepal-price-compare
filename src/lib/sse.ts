import type { PipelineEvent } from "./types";

/** Server-Sent Events frame. The UI also reads `event.type` from the JSON. */
export function formatSse(event: PipelineEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
