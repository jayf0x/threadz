import type { Message, Thread } from "./types";

// An unchecked `- [ ]` line, anywhere in it — not anchored to the start, so "note to self: - [ ] call
// mom" still counts. The box must hold only whitespace: `- [x]` (checked) never matches. Loose on
// purpose; a false positive here just adds a stray row to a read-only list, never loses data.
const OPEN_TODO = /-\s?\[\s*\]/;

// Every unchecked checkbox line in `content`, trimmed, in source order. Multiple todos in one
// message each come back as their own entry.
export const parseOpenTodos = (content: string): string[] =>
  content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => OPEN_TODO.test(line));

export type OpenTodo = {
  id: string; // messageId + line index: unique even when one message holds several todos
  threadId: string;
  threadTitle: string;
  messageId: string;
  text: string; // the raw markdown line, marker included
  createdAt: number; // the message's createdAt — what recency sorts on
};

// Pure cross-thread scan: every open todo across `messages`, newest first. The caller decides where
// `threads`/`messages` come from — see features/todos/useOpenTodos.ts.
export const collectOpenTodos = (threads: Thread[], messages: Message[]): OpenTodo[] => {
  const titleById = new Map(threads.map((t) => [t.id, t.title]));
  const todos: OpenTodo[] = [];
  for (const m of messages) {
    parseOpenTodos(m.content).forEach((text, i) => {
      todos.push({
        id: `${m.id}:${i}`,
        threadId: m.threadId,
        threadTitle: titleById.get(m.threadId) ?? "Untitled thread",
        messageId: m.id,
        text,
        createdAt: m.createdAt,
      });
    });
  }
  return todos.sort((a, b) => b.createdAt - a.createdAt);
};

// Display text: the `- [ ]` marker stripped, for a plain read-only row.
export const stripTodoMarker = (line: string) => line.replace(/^-\s?\[\s*\]\s?/, "");
