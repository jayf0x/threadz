// The `/todo` line grammar, shared by the Todos lens (frontend/src/lib/todos.ts) and the map's todo filter.

// Legacy checkbox syntax. Loose, anywhere in the line, not anchored — so "note to self: - [ ] call
// mom" still counts. Open and done are two separate patterns (not `[xX ]?`) so each can be tested on
// its own. Loose on purpose; a false positive here just adds a stray row, never loses data. Bullet is
// `[-*+]`, not a literal `-`: Crepe's markdown serializer doesn't always emit `-` (observed emitting
// `*`), and `LIST_ITEM_DONE`/`LIST_ITEM_OPEN_CHECKBOX` below already accept any of the three — these
// must match the same set, or `toggleLine` fails to recognize an already-checked `*`/`+` item as
// having a checkbox at all, falls through to the "plain item" branch, and stacks a new `[x] ` onto it
// every toggle instead of flipping the one that's there (bug: repeated unchecking on a `*`-bulleted
// `/todos` item produced `* [x] [x] [x] text`).
export const LEGACY_OPEN = /[-*+]\s?\[\s*\]/;
export const LEGACY_DONE = /[-*+]\s?\[\s*[xX]\s*\]/;

// `/todo <text>` command syntax (a bare `/` — `@/` was awkward to type on a phone; the old `@/todo`
// still parses so existing notes keep working, and a toggle preserves whichever prefix was written).
// Anchored to the start of the (trimmed) line, unlike the legacy checkbox — "start of a line" is the
// whole point of a command trigger, so `I said /todo nope` mid-sentence must NOT match. Closed is real
// markdown strikethrough wrapping the whole command. Group 1 = the prefix, group 2 = the text.
export const COMMAND_OPEN = /^(@?\/todo)(?:\s+(.*))?$/;
export const COMMAND_DONE = /^~~(@?\/todo)(?:\s+(.*?))?~~$/;

// `/todos <title>` — a second command, its own trigger (note the "s"; `^(@?\/todo)(?:\s+…)?$` above
// requires end-of-line or whitespace right after "/todo", so it never matches this one). Anchored
// the same way. The title is everything after the space; empty falls back to "Todos".
export const GROUP_TRIGGER = /^@?\/todos(?:\s+(.*))?$/;

// A list-item line under a `/todos` header. Crepe/remark-stringify always serialize a bullet list
// as `- ` (checked against @milkdown/preset-commonmark's bullet-list toMarkdown — it always emits
// the configured `-` bullet regardless of what was typed), so that's the only marker this app itself
// will ever produce; `*`/`+` are accepted too since CommonMark allows them and raw/imported/pasted
// content can still carry them before Crepe ever normalizes it. Order matters: the checkbox variants
// must be tried before the plain one, or `- [x] text` would match PLAIN first (bullet + space + rest).
export const LIST_ITEM_DONE = /^[-*+]\s+\[\s*[xX]\s*\]\s*(.*)$/;
export const LIST_ITEM_OPEN_CHECKBOX = /^[-*+]\s+\[\s*\]\s*(.*)$/;
export const LIST_ITEM_PLAIN = /^[-*+]\s+(.*)$/;

export type ParsedTodo = {
  text: string; // the raw trimmed line, marker(s) included
  done: boolean;
  lineIndex: number; // index into `content.split("\n")` — which line this came from, for editing it back
};

export type ParsedTodoItem = {
  text: string; // display text, marker(s) already stripped
  done: boolean;
  lineIndex: number; // index into `content.split("\n")`, for editing it back (same idea as ParsedTodo)
};

export type ParsedTodoGroup = {
  title: string;
  titleLineIndex: number;
  items: ParsedTodoItem[];
};

const parseListItemLine = (line: string): { text: string; done: boolean } | null => {
  const done = line.match(LIST_ITEM_DONE);
  if (done) return { text: done[1] ?? "", done: true };
  const openChecked = line.match(LIST_ITEM_OPEN_CHECKBOX);
  if (openChecked) return { text: openChecked[1] ?? "", done: false };
  const plain = line.match(LIST_ITEM_PLAIN);
  if (plain) return { text: plain[1] ?? "", done: false };
  return null;
};

// Every `/todos <title>` group in `content`: the trigger line plus the contiguous run of list-item
// lines right after it — stops at the first blank line after that (or the first line that isn't a list item, a
// paragraph resuming under the header, say). A trigger with nothing under it isn't a group (nothing
// to show), so it's left alone entirely. `consumed` carries every line index a group ate, so
// `parseTodos` below can skip them — a `- [ ]` item under a `/todos` header must not ALSO come back
// as its own flat legacy todo.
export const parseTodoGroups = (content: string): { groups: ParsedTodoGroup[]; consumed: Set<number> } => {
  const lines = content.split("\n");
  const groups: ParsedTodoGroup[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const trigger = line.trim().match(GROUP_TRIGGER);
    if (!trigger) continue;
    const items: ParsedTodoItem[] = [];
    let j = i + 1;
    // The editor serializes a title paragraph and the list under it with a blank line between them
    // (`/todos T\n\n- a`), so blank lines are tolerated between the trigger and the *first* item only.
    while (lines[j]?.trim() === "") j++;
    for (; j < lines.length; j++) {
      const raw = lines[j];
      if (raw === undefined || raw.trim() === "") break;
      const item = parseListItemLine(raw.trim());
      if (!item) break;
      items.push({ ...item, lineIndex: j });
    }
    if (items.length === 0) continue;
    groups.push({ title: trigger[1]?.trim() || "Todos", titleLineIndex: i, items });
    consumed.add(i);
    for (const it of items) consumed.add(it.lineIndex);
    i = j - 1; // resume scanning right after the consumed run
  }
  return { groups, consumed };
};

// Every single-line todo (either syntax, open or closed) in `content`, trimmed, in source order —
// skipping any line a `/todos` group above already claimed. Multiple todos in one message each
// come back as their own entry.
export const parseTodos = (content: string): ParsedTodo[] => {
  const { consumed } = parseTodoGroups(content);
  const todos: ParsedTodo[] = [];
  content.split("\n").forEach((raw, lineIndex) => {
    if (consumed.has(lineIndex)) return;
    const line = raw.trim();
    if (COMMAND_DONE.test(line)) todos.push({ text: line, done: true, lineIndex });
    else if (COMMAND_OPEN.test(line)) todos.push({ text: line, done: false, lineIndex });
    else if (LEGACY_DONE.test(line)) todos.push({ text: line, done: true, lineIndex });
    else if (LEGACY_OPEN.test(line)) todos.push({ text: line, done: false, lineIndex });
  });
  return todos;
};
