import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { PlainBlock } from "./plainMarkdown";

// The read view of a simple message before its Milkdown editor exists: the same wrapper classes as the
// editor's own DOM (`.threadz-md > .milkdown > .ProseMirror`), so markdown-editor.css styles it identically
// and the row keeps its height when the editor takes over. `padding` is the editor's `--md-padding`.
export const PlainMarkdown = ({
  blocks,
  padding,
  className,
}: {
  blocks: PlainBlock[];
  padding: string;
  className?: string;
}) => (
  <div
    className={cn("threadz-md [--md-min-height:0px]", className)}
    style={{ "--md-padding": padding } as React.CSSProperties}
  >
    <div className="milkdown">
      <div className="ProseMirror" contentEditable={false} suppressContentEditableWarning>
        {blocks.map((b, i) => {
          // Blocks are static and never reorder: an index key is the identity.
          const key = i;
          const kids = b.inline.map((t, j) => {
            // biome-ignore lint/suspicious/noArrayIndexKey: static inline run
            if (t.kind === "strong") return <strong key={j}>{t.text}</strong>;
            // biome-ignore lint/suspicious/noArrayIndexKey: static inline run
            if (t.kind === "em") return <em key={j}>{t.text}</em>;
            // biome-ignore lint/suspicious/noArrayIndexKey: static inline run
            if (t.kind === "code") return <code key={j}>{t.text}</code>;
            return t.text;
          });
          return b.level === 0 ? (
            <p key={key}>{kids}</p>
          ) : b.level === 1 ? (
            <h1 key={key}>{kids}</h1>
          ) : b.level === 2 ? (
            <h2 key={key}>{kids}</h2>
          ) : (
            <h3 key={key}>{kids}</h3>
          );
        })}
      </div>
    </div>
  </div>
);

// One editor mounts per idle slot, so a thread of forty rows doesn't run forty Milkdown loads in a row on
// the main thread: the preview is already on screen, the editors arrive as the browser has time. A row that
// wants its editor now (selected, editing) skips the line via `now`.
const queue: (() => void)[] = [];
let draining = false;

const drain = () => {
  const next = queue.shift();
  if (!next) {
    draining = false;
    return;
  }
  next();
  schedule(drain);
};

const schedule = (fn: () => void) =>
  typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 40);

export const useEditorSlot = (now: boolean) => {
  const [live, setLive] = useState(now);
  useEffect(() => {
    if (live) return;
    if (now) {
      setLive(true);
      return;
    }
    const take = () => setLive(true);
    queue.push(take);
    if (!draining) {
      draining = true;
      schedule(drain);
    }
    return () => {
      const i = queue.indexOf(take);
      if (i >= 0) queue.splice(i, 1);
    };
  }, [live, now]);
  return live;
};
