import { getMessages, getThread, setMetadata } from "./db";
import { embed, ollamaGenerateJson } from "./model";

// Runs synchronously or fire-and-forget on commit. No queue, no tiers —
// personal volume + local model = a couple seconds, commits are human-paced.

// gemma3:270m is tiny — it needs a worked example or it parrots the instructions
// back. Few-shot + a sanity filter on the way out.
const SYSTEM = `You summarise a personal knowledge thread. Output ONLY JSON:
{"description": string, "tags": string[]}
- description: one plain sentence describing what the thread is about, <= 140 chars.
- tags: 3 to 6 short lowercase topic keywords.

Example input:
Thread title: Sourdough hydration
Messages:
user: notes — 70% hydration, 20% starter, 18h cold proof, bread flour
Example output:
{"description":"Notes on a high-hydration sourdough recipe and its cold-proof schedule.","tags":["sourdough","baking","hydration","cold-proof"]}`;

// Reject output that's just the instructions echoed back (small local models do this).
export const looksLikeGarbage = (s: string) =>
  /<=?\s*140|one sentence|short lowercase|topic (tag|keyword)|^string$/i.test(s.trim());

// Skip generation entirely below this — nothing to summarise, model will invent/parrot.
export const MIN_WORDS = 4;

// Images are `![](img:<hash>#WxH)` — noise to a text summariser.
export const stripImages = (s: string) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

export const generateMetadata = async (threadId: string) => {
  const thread = getThread(threadId);
  if (!thread) return;
  const messages = getMessages(threadId);
  const transcript = messages
    .map((m) => `${m.role}: ${stripImages(m.content)}`)
    .join("\n")
    .slice(0, 6000);

  let description = thread.description || "";
  let tags: string[] = thread.tags ? JSON.parse(thread.tags) : [];

  // Too little to summarise — don't let the model invent/parrot. Fall back to the title.
  const wordCount = `${thread.title} ${transcript}`.split(/\s+/).filter(Boolean).length;
  if (wordCount < MIN_WORDS) {
    description = "";
    tags = [];
  } else {
    try {
      const out = await ollamaGenerateJson<{ description?: string; tags?: string[] }>(
        `Thread title: ${thread.title}\nMessages:\n${transcript}`,
        SYSTEM,
      );
      if (out.description && !looksLikeGarbage(out.description)) {
        description = String(out.description).slice(0, 200);
      }
      if (Array.isArray(out.tags)) {
        const clean = out.tags
          .map((t) => String(t).toLowerCase().trim())
          .filter((t) => t && t.length <= 30 && !looksLikeGarbage(t));
        if (clean.length) tags = clean.slice(0, 6);
      }
    } catch (err) {
      console.error("[threadz] metadata gen failed", err);
    }
  }

  const summaryText = `${thread.title}\n${description}\n${tags.join(", ")}\n${transcript.slice(0, 2000)}`;
  const [vec] = await embed([summaryText], "document");
  if (!vec) throw new Error("embed returned no vector");
  setMetadata(threadId, description, tags, vec);
};

// Fire-and-forget wrapper used by append/commit paths.
export const refreshMetadata = (threadId: string) => {
  generateMetadata(threadId).catch((err) => console.error("[threadz] refreshMetadata", err));
};
