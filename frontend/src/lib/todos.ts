import type { Message, Thread } from "./types";

// Legacy checkbox syntax. Loose, anywhere in the line, not anchored — so "note to self: - [ ] call
// mom" still counts. Open and done are two separate patterns (not `[xX ]?`) so each can be tested on
// its own. Loose on purpose; a false positive here just adds a stray row, never loses data.
const LEGACY_OPEN = /-\s?\[\s*\]/;
const LEGACY_DONE = /-\s?\[\s*[xX]\s*\]/;

// `@/todo <text>` command syntax. Anchored to the start of the (trimmed) line, unlike the legacy
// checkbox — "start of a line" is the whole point of a command trigger, so `I said @/todo nope`
// mid-sentence must NOT match. Closed is real markdown strikethrough wrapping the whole command.
const COMMAND_OPEN = /^@\/todo(?:\s+(.*))?$/;
const COMMAND_DONE = /^~~@\/todo(?:\s+(.*?))?~~$/;

export type ParsedTodo = {
  text: string; // the raw trimmed line, marker(s) included
  done: boolean;
  lineIndex: number; // index into `content.split("\n")` — which line this came from, for editing it back
};

// Every todo line in `content` (either syntax, open or closed), trimmed, in source order. Multiple
// todos in one message each come back as their own entry.
export const parseTodos = (content: string): ParsedTodo[] => {
  const todos: ParsedTodo[] = [];
  content.split("\n").forEach((raw, lineIndex) => {
    const line = raw.trim();
    if (COMMAND_DONE.test(line)) todos.push({ text: line, done: true, lineIndex });
    else if (COMMAND_OPEN.test(line)) todos.push({ text: line, done: false, lineIndex });
    else if (LEGACY_DONE.test(line)) todos.push({ text: line, done: true, lineIndex });
    else if (LEGACY_OPEN.test(line)) todos.push({ text: line, done: false, lineIndex });
  });
  return todos;
};

export type Todo = {
  id: string; // messageId + index: unique even when one message holds several todos
  threadId: string;
  threadTitle: string;
  messageId: string;
  messageContent: string; // the message's full raw content — needed to reconstruct an edit on toggle
  lineIndex: number; // this todo's line within `messageContent.split("\n")`
  text: string; // the raw markdown line, marker included
  done: boolean;
  createdAt: number; // the message's createdAt — what recency sorts on
};

// Pure cross-thread scan: every todo (open or closed) across `messages`, newest first. The caller
// decides where `threads`/`messages` come from — see features/todos/useTodos.ts.
export const collectTodos = (threads: Thread[], messages: Message[]): Todo[] => {
  const titleById = new Map(threads.map((t) => [t.id, t.title]));
  const todos: Todo[] = [];
  for (const m of messages) {
    parseTodos(m.content).forEach((todo, i) => {
      todos.push({
        id: `${m.id}:${i}`,
        threadId: m.threadId,
        threadTitle: titleById.get(m.threadId) ?? "Untitled thread",
        messageId: m.id,
        messageContent: m.content,
        lineIndex: todo.lineIndex,
        text: todo.text,
        done: todo.done,
        createdAt: m.createdAt,
      });
    });
  }
  return todos.sort((a, b) => b.createdAt - a.createdAt);
};

// Display text: whichever marker matched (`@/todo `, the `~~` wrapper, `- [ ]`/`- [x]`) stripped, for
// a plain row.
export const stripTodoMarker = (line: string): string => {
  const commandDone = line.match(COMMAND_DONE);
  if (commandDone) return commandDone[1] ?? "";
  const commandOpen = line.match(COMMAND_OPEN);
  if (commandOpen) return commandOpen[1] ?? "";
  return line.replace(/^-\s?\[\s*[xX]?\s*\]\s?/, "");
};

// Flips one line between open and closed, preserving its indentation. `lineIndex` is the line's
// index into `content.split("\n")` — `Todo.lineIndex`, from the same parse that found it. Pure text
// transform: the caller is responsible for persisting the result (`editMessage`).
export const toggleTodoLine = (content: string, lineIndex: number): string => {
  const lines = content.split("\n");
  const raw = lines[lineIndex];
  if (raw === undefined) return content;
  const indent = raw.slice(0, raw.length - raw.trimStart().length);
  lines[lineIndex] = indent + toggleLine(raw.trim());
  return lines.join("\n");
};

const toggleLine = (line: string): string => {
  const commandDone = line.match(COMMAND_DONE);
  if (commandDone) return `@/todo ${commandDone[1] ?? ""}`;
  const commandOpen = line.match(COMMAND_OPEN);
  if (commandOpen) return `~~@/todo ${commandOpen[1] ?? ""}~~`;
  if (LEGACY_DONE.test(line)) return line.replace(/\[\s*[xX]\s*\]/, "[ ]");
  if (LEGACY_OPEN.test(line)) return line.replace(/\[\s*\]/, "[x]");
  return line;
};
