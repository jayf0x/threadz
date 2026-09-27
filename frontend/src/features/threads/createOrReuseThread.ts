import { createThread, listThreads, threadMessages } from "@/lib/data";
import type { Thread } from "@/lib/types";
import { isPlaceholderTitle, nextTitle } from "./titles";

// No form: a thread exists the moment you ask for one, named by its number. But not a second
// empty one in a row: if the newest thread is still an untouched placeholder (auto-generated
// title, no notes yet), reuse it instead of leaving another behind. Shared by the sidebar's
// New button/`n` and the `/capture` deep link (`App.tsx`) — same "don't pile up placeholders" rule either way.
export const createOrReuseThread = async (): Promise<string> => {
  const existing = await listThreads();
  const newest = existing.reduce<Thread | undefined>(
    (best, t) => (!best || t.createdAt > best.createdAt ? t : best),
    undefined,
  );
  if (newest && isPlaceholderTitle(newest.title) && (await threadMessages(newest.id)).length === 0) {
    return newest.id;
  }
  const title = nextTitle(existing.map((t) => t.title));
  const thread = await createThread(title);
  return thread.id;
};
