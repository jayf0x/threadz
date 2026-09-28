import { ArrowLeft, ChevronRight, ListTodo, type LucideIcon, Sparkles, Waves } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { mapUrl } from "@/features/map";
import type { Insight } from "@/lib/data";
import { stripTodoMarker, type Todo } from "@/lib/todos";
import { useHome } from "./useHome";
import { useTodosSummary } from "./useTodosSummary";

/** Where a Home card sends the sidebar: the panel only, no filter (the panels have no inputs for an insight's cutoffs). */
export type HomeTarget = { lens: "index" | "todos" | "pool" };

const SHOWN_TODOS = 3;

// The dashboard behind the header title (docs/direction.md "Round 7"): a navigation surface, not a lens of
// its own — every block just points at the tab that owns the data.
export const HomePanel = ({
  onBack,
  onGo,
  onOpenThread,
}: {
  onBack: () => void;
  onGo: (target: HomeTarget) => void;
  onOpenThread: (threadId: string, messageId?: string) => void;
}) => {
  const home = useHome();
  const { open, newest } = useTodosSummary(SHOWN_TODOS);

  return (
    <>
      <header className="px-2 pb-3 pt-6 md:px-5">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Back to index" className="shrink-0" onClick={onBack}>
            <ArrowLeft className="size-5" />
          </Button>
          <h1 className="pl-1 font-serif text-[32px] leading-none tracking-tight">Home</h1>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-rule pb-6">
        {home && home.recent.length > 0 && (
          <Section title="Recent">
            {home.recent.map((t) => (
              <Row key={t.id} onClick={() => onOpenThread(t.id)}>
                <span className="block truncate font-serif text-lg leading-snug">{t.title}</span>
              </Row>
            ))}
          </Section>
        )}

        <Section title="Todos">
          <Row onClick={() => onGo({ lens: "todos" })} icon={ListTodo} aside={String(open)}>
            <span className="text-sm">Open</span>
          </Row>
          {newest.map((t) => (
            <Row key={t.id} onClick={() => onOpenThread(t.threadId, t.kind === "thread" ? undefined : t.messageId)}>
              <span className="block truncate text-sm text-muted-foreground">{todoLabel(t)}</span>
            </Row>
          ))}
        </Section>

        <Section title="Pool">
          <Row onClick={() => onGo({ lens: "pool" })} icon={Waves} aside={String(home?.poolCount ?? 0)}>
            <span className="text-sm">Loose notes</span>
          </Row>
        </Section>

        {home && home.insights.length > 0 && (
          <Section title="Insight">
            {home.insights.map((i) => (
              <Row key={i.id} onClick={() => followInsight(i, onGo)} icon={Sparkles}>
                <span className="text-sm leading-snug">{i.text}</span>
              </Row>
            ))}
          </Section>
        )}
      </div>
    </>
  );
};

const todoLabel = (t: Todo): string => {
  if (t.kind === "thread") return t.threadTitle;
  if (t.kind === "group") return t.title;
  if (t.kind === "line") return stripTodoMarker(t.text);
  return t.messageContent.split("\n")[0] || t.threadTitle;
};

const LENS_TARGET: Record<string, HomeTarget["lens"] | undefined> = { thread: "index", todos: "todos", pool: "pool" };

// Only a map insight carries a filter (`/map?<MapFilter>`); Threadz, Todos and Pool cards just open their panel.
const followInsight = (i: Insight, onGo: (t: HomeTarget) => void) => {
  const { lens, filter } = i.source;
  if (lens === "map") {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) params.set(k, typeof v === "string" ? v : JSON.stringify(v));
    history.pushState(null, "", mapUrl(params.toString()));
    dispatchEvent(new PopStateEvent("popstate")); // App re-reads the URL and opens the map
    return;
  }
  onGo({ lens: LENS_TARGET[lens] ?? "index" });
};

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="pt-4">
    <Eyebrow className="px-5 pb-1">{title}</Eyebrow>
    <ul>{children}</ul>
  </section>
);

const Row = ({
  children,
  onClick,
  icon: Icon,
  aside,
}: {
  children: ReactNode;
  onClick: () => void;
  icon?: LucideIcon;
  aside?: string;
}) => (
  <li>
    <button
      type="button"
      onClick={onClick}
      className="press-row flex min-h-11 w-full items-center gap-3 px-5 py-2 text-left"
    >
      {Icon && <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground md:size-4" />}
      <span className="min-w-0 flex-1">{children}</span>
      {aside && <span className="text-sm tabular-nums text-muted-foreground">{aside}</span>}
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </button>
  </li>
);
