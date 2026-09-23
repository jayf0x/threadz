import { useCallback, useEffect, useState } from "react";
import { exportSnapshot } from "@/lib/local";
import { onChange } from "@/lib/sync";
import { collectTodos, type Todo } from "@/lib/todos";

// Reads the device copy (`threadz-local`) directly, live or local alike: while live it's kept warm
// on every pull (lib/sync.ts's keepReplicaWarm -> lib/replica.ts's pullMain), so it already holds
// every thread's messages by the time this mounts — no new backend endpoint, no per-thread walk over
// the live API. `null` = not loaded yet, so the panel can tell "still loading" from "genuinely empty".
// Open only, for now — see features/todos/TodosPanel.tsx for the closed-todo filter.
export const useOpenTodos = () => {
  const [todos, setTodos] = useState<Todo[] | null>(null);

  const load = useCallback(() => {
    exportSnapshot().then(
      ({ threads, messages }) => setTodos(collectTodos(threads, messages).filter((t) => !t.done)),
      () => setTodos([]),
    );
  }, []);

  useEffect(() => {
    load();
    return onChange(load); // a note added/edited anywhere re-runs the scan
  }, [load]);

  return todos;
};
