import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { exportSnapshot } from "@/lib/local";
import { onChange, pullThread } from "@/lib/sync";
import { collectTodos, type ParsedTodoItem, type Todo, toggleTodoLine } from "@/lib/todos";

// Reads the device copy (`threadz-local`) directly, live or local alike: while live it's kept warm
// on every pull (lib/sync.ts's keepReplicaWarm -> lib/replica.ts's pullMain), so it already holds
// every thread's messages by the time this mounts — no new backend endpoint, no per-thread walk over
// the live API. `null` = not loaded yet, so the panel can tell "still loading" from "genuinely empty".
export const useTodos = () => {
  const [todos, setTodos] = useState<Todo[] | null>(null);

  const load = useCallback(() => {
    exportSnapshot().then(
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
  // todo has no line at all — it's non-textual (`meta.todo.done`), so it skips `toggleTodoLine`/
  // `editMessage` entirely and goes through the meta-only call instead (see
  // "Grouped todo lists + convert-a-message action"). `pullThread` (not `load`) refreshes the
  // mirror/replica and fires `onChange`, which re-runs `load`.
  const toggle = useCallback(async (todo: Todo, item?: ParsedTodoItem) => {
    try {
      if (todo.kind === "message") {
        await api.toggleMessageTodo(todo.threadId, todo.messageId, !todo.done);
      } else {
        const lineIndex = todo.kind === "group" ? item?.lineIndex : todo.lineIndex;
        if (lineIndex === undefined) return;
        const content = toggleTodoLine(todo.messageContent, lineIndex);
        await api.editMessage(todo.threadId, todo.messageId, content);
      }
      await pullThread(todo.threadId);
    } catch {
      // best effort — nothing else to show here, the row just stays as it was
    }
  }, []);

  return { todos, toggle };
};
