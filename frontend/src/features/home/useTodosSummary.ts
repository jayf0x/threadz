import { useMemo } from "react";
import { useTodos } from "@/features/todos";
import type { Todo } from "@/lib/todos";

// Open todos for Home: a count (a group is open while any item is) plus the newest few, from the
// same `useTodos` scan the Todos tab uses so the two never disagree.
export const useTodosSummary = (shown: number): { open: number; newest: Todo[] } => {
  const { todos } = useTodos();
  return useMemo(() => {
    const live = (todos ?? []).filter((t) => (t.kind === "group" ? t.items.some((i) => !i.done) : !t.done));
    return { open: live.length, newest: live.slice(0, shown) };
  }, [todos, shown]);
};
