import { useCallback, useEffect, useState } from "react";
import { onChange } from "@/lib/changeSignal";
import { allMessages, editMessage, setTodo } from "@/lib/data";
import { collectTodos, type ParsedTodoItem, type Todo, toggleTodoLine } from "@/lib/todos";

// Reads every thread's messages directly (`lib/data.ts`'s `allMessages`) — the phone's own database
// is the only store now, live or offline alike, so there's no separate "kept warm" replica to read
// instead (see v1's `lib/replica.ts`, since deleted). `null` = not loaded yet, so the panel can tell
// "still loading" from "genuinely empty".
export const useTodos = () => {
  const [todos, setTodos] = useState<Todo[] | null>(null);

  const load = useCallback(() => {
    allMessages().then(
      ({ threads, messages }) => setTodos(collectTodos(threads, messages)),
      () => setTodos([]),
    );
  }, []);

  useEffect(() => {
    load();
    return onChange(load); // a note added/edited anywhere re-runs the scan
  }, [load]);

  // Rewrites just this todo's line (open<->closed) and saves it through the same `editMessage`
  // every other edit uses — text is the only source of truth, ticking a box is a content edit.
  // A "group" todo has several items, each its own line, so `item` picks which one; a "message"
  // todo has no line at all — it's non-textual (the `todos` table), so it skips `toggleTodoLine`/
  // `editMessage` entirely and goes through `setTodo` instead (see
  // "Grouped todo lists + convert-a-message action"). `emitChange` (inside `data.ts`'s writes)
  // re-runs `load`.
  const toggle = useCallback(async (todo: Todo, item?: ParsedTodoItem) => {
    try {
      if (todo.kind === "message") {
        await setTodo(todo.messageId, !todo.done);
      } else {
        const lineIndex = todo.kind === "group" ? item?.lineIndex : todo.lineIndex;
        if (lineIndex === undefined) return;
        const content = toggleTodoLine(todo.messageContent, lineIndex);
        await editMessage(todo.messageId, content);
      }
    } catch {
      // best effort — nothing else to show here, the row just stays as it was
    }
  }, []);

  return { todos, toggle };
};
