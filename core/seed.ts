// Pure sample-data generator (no bun/node imports, so the app bundle can use it too): rows are built in memory
// as a core `Changes`. No clock and no randomUUID: every id and timestamp derives from one mulberry32 stream,
// the `now` it is given and an optional id `salt`, so the same params produce the same rows. `scripts/seed.ts`
// is the CLI over it; Settings > Dev "Add sample data" calls it with a fresh seed and salt per press.
import { emptyChanges } from "./merge";
import { DAY_MS } from "./insights";
import { BUILTIN, type Changes } from "./schema";

export const SCALES = {
  small: { threads: 50, notes: 250, versions: 1200 },
  real: { threads: 2000, notes: 10000, versions: 50000 },
  large: { threads: 8000, notes: 40000, versions: 200000 },
} as const;
export type Scale = keyof typeof SCALES;
export type SeedCounts = { threads: number; notes: number; versions: number };

export const SEED_NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
const SPAN_DAYS = 730;
const HOUR = 3_600_000;

export type SeedParams = {
  counts: SeedCounts;
  /** mulberry32 seed. */
  seed: number;
  /** Timestamps are relative to this: everything lands within the two years before it. */
  now: number;
  /** A nonzero salt replaces the first uuid group, so ids from batches with different salts never collide. */
  salt?: number;
};

const mulberry32 = (seed: number) => () => {
  seed += 0x6d2b79f5;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// --- vocabulary ----------------------------------------------------------------------------------------

const TOPICS = [
  "Garden",
  "Trip planning",
  "Recipes",
  "Book notes",
  "Fitness",
  "Home renovation",
  "Side project",
  "Finances",
  "Guitar",
  "Learning Rust",
  "Photography",
  "Health",
  "Reading list",
  "Ideas",
  "Car",
  "Meal prep",
  "Spanish",
  "Gift ideas",
  "Meetings",
  "Sourdough",
  "Running",
  "Budget",
  "Woodworking",
  "Podcast",
  "Career",
  "Moving",
];
const ASPECTS = [
  "plan",
  "log",
  "questions",
  "shopping",
  "research",
  "ideas",
  "notes",
  "checklist",
  "review",
  "goals",
  "drafts",
  "quotes",
  "mistakes",
  "next steps",
  "inbox",
];
const SUBJECTS = [
  "the plan",
  "this approach",
  "the schedule",
  "my routine",
  "the draft",
  "that idea",
  "the budget",
  "the recipe",
  "our setup",
  "the old method",
  "the second option",
  "her suggestion",
  "the tool",
  "this week",
  "the deadline",
];
const VERBS = [
  "needs a second look",
  "works better than expected",
  "keeps slipping",
  "is worth revisiting",
  "feels too slow",
  "should be simplified",
  "still has gaps",
  "paid off",
  "got harder",
  "clicked today",
  "is on hold",
  "needs more data",
];
const TAILS = [
  "before the weekend",
  "once the rest is settled",
  "if the weather holds",
  "unless something changes",
  "after talking it through",
  "compared to last month",
  "for now",
  "with a small tweak",
  "in the long run",
  "and that is fine",
  "which surprised me",
  "so I wrote it down",
];
const ITEMS = [
  "call the dentist",
  "book the train",
  "buy filament",
  "email the landlord",
  "renew passport",
  "water the plants",
  "back up the photos",
  "order flour",
  "draft the outline",
  "review the pull request",
  "cancel the trial",
  "pick up the parcel",
  "sketch the layout",
  "read chapter four",
  "update the spreadsheet",
  "fix the shelf",
];
const LINKS = ["https://example.com/guide", "https://en.wikipedia.org/wiki/Sourdough", "https://news.example.org/a/42"];
const STATUSES = ["todo", "doing", "done", "blocked"];
const AREAS = ["home", "work", "health", "learning", "travel", "money"];
const LINK_TYPES = ["supports", "contradicts", "follows", "example of"];
const SIZES = ["1200x800", "800x1200", "1600x900", "640x640", "3024x4032"];

// --- generator -----------------------------------------------------------------------------------------

type NoteSk = {
  id: string;
  kind: "thread" | "pool" | "attached" | "copy";
  thread: number; // index into threads, -1 when none
  created: number;
  vids: string[];
  vtimes: number[];
  msgId: string | null;
  assistant: boolean;
  copyOf: number;
};
type ThreadSk = {
  id: string;
  start: number;
  end: number;
  skew: number;
  weight: number;
  msgs: { id: string; noteIdx: number; created: number }[];
  upd: number;
  first: number;
};

export const generateSeed = ({ counts: target, seed, now: NOW, salt = 0 }: SeedParams): Changes => {
  const END_MAX = NOW - 6 * HOUR;
  const rng = mulberry32(seed);
  const int = (n: number) => Math.floor(rng() * n);
  const pick = <T>(a: readonly T[]): T => a[int(a.length)] as T;
  const chance = (p: number) => rng() < p;
  const hex = (n: number) => {
    let s = "";
    while (s.length < n) s += ((rng() * 0x100000000) >>> 0).toString(16).padStart(8, "0");
    return s.slice(0, n);
  };
  const saltHex = (salt >>> 0).toString(16).padStart(8, "0");
  const uuid = () => `${hex(8).replace(/^.*$/, (h) => (salt ? saltHex : h))}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;

  const c = emptyChanges();

  // Weekly activity: some weeks are much busier, and later weeks a little busier than earlier ones.
  const weeks = Math.floor(SPAN_DAYS / 7);
  const cum: number[] = [];
  let acc = 0;
  for (let k = 0; k < weeks; k++) {
    acc += (0.25 + rng() ** 3 * 4) * (1 + k / weeks);
    cum.push(acc);
  }
  const pickWeek = (maxWeek = weeks) => {
    const limit = cum[maxWeek - 1] as number;
    const x = rng() * limit;
    let lo = 0;
    let hi = maxWeek - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cum[mid] as number) < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const weekStart = (k: number) => NOW - (weeks - k) * 7 * DAY_MS;
  const withHour = (t: number) => {
    const hour = Math.min(23, 7 + Math.floor(rng() * rng() * 17) + int(3));
    return Math.min(END_MAX, Math.floor(t / DAY_MS) * DAY_MS + hour * HOUR + int(HOUR));
  };

  // -- skeleton: threads, note times and ids
  const threads: ThreadSk[] = [];
  for (let i = 0; i < target.threads; i++) {
    const roll = rng();
    let start: number;
    let end: number;
    let skew = 1.3;
    if (roll < 0.12) {
      start = NOW - (5 + rng() * 60) * DAY_MS;
      end = END_MAX - rng() * 2 * DAY_MS;
      skew = 0.5;
    } else if (roll < 0.22) {
      start = weekStart(pickWeek(weeks - 20)) + int(7) * DAY_MS;
      end = start + (2 + rng() ** 2 * 40) * DAY_MS;
    } else {
      start = weekStart(pickWeek()) + int(7) * DAY_MS;
      end = Math.min(END_MAX, start + (2 + rng() ** 2 * 150) * DAY_MS);
    }
    start = Math.min(start, end - HOUR);
    threads.push({ id: uuid(), start, end, skew, weight: 0.2 + rng() ** 2 * 3, msgs: [], upd: 0, first: Infinity });
  }
  const twCum: number[] = [];
  let twAcc = 0;
  for (const t of threads) {
    twAcc += t.weight;
    twCum.push(twAcc);
  }
  const pickThread = () => {
    const x = rng() * twAcc;
    let lo = 0;
    let hi = twCum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((twCum[mid] as number) < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const nPool = Math.round(target.notes * 0.08);
  const nAttached = Math.round(target.notes * 0.05);
  const nCopy = Math.round(target.notes * 0.02);
  const nThread = target.notes - nPool - nAttached - nCopy;

  const versionCounts: number[] = [];
  const avg = target.versions / target.notes;
  let vsum = 0;
  for (let i = 0; i < target.notes; i++) {
    const n = 1 + Math.floor(rng() ** 2 * 3 * (avg - 1));
    versionCounts.push(n);
    vsum += n;
  }
  while (vsum < target.versions) {
    const i = int(target.notes);
    versionCounts[i] = (versionCounts[i] as number) + 1;
    vsum++;
  }
  while (vsum > target.versions) {
    const i = int(target.notes);
    if ((versionCounts[i] as number) > 1) {
      versionCounts[i] = (versionCounts[i] as number) - 1;
      vsum--;
    }
  }

  const notes: NoteSk[] = [];
  const timeIn = (t: ThreadSk) => withHour(t.start + (t.end - t.start) * rng() ** t.skew);
  for (let i = 0; i < nThread; i++) {
    // every thread gets one note first, the rest are spread by thread weight
    const ti = i < threads.length ? i : pickThread();
    const t = threads[ti] as ThreadSk;
    notes.push(newNote("thread", ti, timeIn(t), t.end));
  }
  for (let i = 0; i < nPool; i++) {
    const created = withHour(weekStart(pickWeek()) + int(7) * DAY_MS);
    notes.push(newNote("pool", -1, created, created + rng() * 60 * DAY_MS));
  }
  const attachedTargets: { msgIdx: number; note: NoteSk }[] = [];
  for (let i = 0; i < nAttached; i++) {
    const host = notes[int(nThread)] as NoteSk;
    const created = host.created + Math.min(rng() * 2 * DAY_MS, END_MAX - host.created) + 60_000;
    const n = newNote("attached", -1, Math.min(created, END_MAX), Math.min(END_MAX, created + rng() * 5 * DAY_MS));
    attachedTargets.push({ msgIdx: notes.indexOf(host), note: n });
    notes.push(n);
  }
  for (let i = 0; i < nCopy; i++) {
    const src = int(nThread);
    const at = pickThread();
    const t = threads[at] as ThreadSk;
    const n = newNote("copy", at, timeIn(t), t.end);
    n.copyOf = src;
    notes.push(n);
  }

  function newNote(kind: NoteSk["kind"], thread: number, created: number, limit: number): NoteSk {
    const idx = notes.length;
    const count = versionCounts[idx] as number;
    const vids: string[] = [];
    const vtimes: number[] = [];
    let prev = created;
    for (let k = 0; k < count; k++) {
      if (k > 0) prev += 60_000 + Math.floor(rng() ** 2 * Math.min(14 * DAY_MS, Math.max(0, limit - prev)));
      vids.push(uuid());
      vtimes.push(prev);
    }
    return {
      id: uuid(),
      kind,
      thread,
      created,
      vids,
      vtimes,
      msgId: kind === "thread" || kind === "copy" ? uuid() : null,
      assistant: kind === "thread" && chance(0.04),
      copyOf: -1,
    };
  }

  // Register primary placements and thread activity.
  const bump = (t: ThreadSk, at: number) => {
    if (at > t.upd) t.upd = at;
  };
  notes.forEach((n, idx) => {
    if (!n.msgId) return;
    const t = threads[n.thread] as ThreadSk;
    t.msgs.push({ id: n.msgId, noteIdx: idx, created: n.created });
    t.first = Math.min(t.first, n.created);
    bump(t, n.vtimes[n.vtimes.length - 1] as number);
  });

  // A few notes live in several threads.
  const extraMsgs: { id: string; thread: number; noteIdx: number; created: number }[] = [];
  const nMulti = Math.round(nThread * 0.08);
  for (let i = 0; i < nMulti; i++) {
    const noteIdx = int(nThread);
    const n = notes[noteIdx] as NoteSk;
    const ti = pickThread();
    if (ti === n.thread) continue;
    const t = threads[ti] as ThreadSk;
    const created = Math.max(n.created + HOUR, timeIn(t));
    const m = { id: uuid(), thread: ti, noteIdx, created };
    extraMsgs.push(m);
    t.msgs.push(m);
    t.first = Math.min(t.first, created);
    bump(t, created);
  }

  // -- content
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const sentence = () => `${`${cap(pick(SUBJECTS))} ${pick(VERBS)} ${chance(0.6) ? pick(TAILS) : ""}`.trim()}.`;
  const paragraph = (n = 2 + int(3)) => Array.from({ length: n }, sentence).join(" ");
  const image = () => `![](img:${hex(64)}#${pick(SIZES)})`;
  const todoLine = () => (chance(0.3) ? `~~/todo ${pick(ITEMS)}~~` : `/todo ${pick(ITEMS)}`);
  const ref = () => {
    const r = rng();
    if (r < 0.4) return `[${pick(TOPICS)} thread](tz:thread/${(pick(threads) as ThreadSk).id})`;
    if (r < 0.7) {
      const t = pick(threads);
      const m = t.msgs[0];
      if (m) return `[that message](tz:message/${t.id}/${m.id})`;
    }
    const n = notes[int(nThread)] as NoteSk;
    const stale = n.vids.length > 1 && chance(0.7);
    return `[earlier note](tz:note/${n.id}@${stale ? n.vids[0] : n.vids[n.vids.length - 1]})`;
  };
  const shape = () => {
    const r = rng();
    if (r < 0.22) return sentence();
    if (r < 0.46) return paragraph();
    if (r < 0.6) return Array.from({ length: 2 + int(3) }, () => paragraph(3 + int(3))).join("\n\n");
    if (r < 0.72) {
      const items = Array.from({ length: 3 + int(4) }, () => `- ${sentence()}`).join("\n");
      return `## ${pick(TOPICS)} ${pick(ASPECTS)}\n\n${items}`;
    }
    if (r < 0.8) return `${sentence()}\n\n${Array.from({ length: 1 + int(3) }, todoLine).join("\n")}`;
    if (r < 0.83) {
      const items = Array.from({ length: 3 }, () => `- [${chance(0.4) ? "x" : " "}] ${pick(ITEMS)}`).join("\n");
      return `/todos ${pick(TOPICS)}\n\n${items}`;
    }
    if (r < 0.87) return `${sentence()}\n\n\`\`\`ts\nconst ${pick(ASPECTS).replace(/\s/g, "")} = ${int(100)};\n\`\`\``;
    if (r < 0.92) return `${paragraph()}\n\n${image()}`;
    if (r < 0.95) return `${sentence()} ${LINKS[int(LINKS.length)]}`;
    if (r < 0.96) return Array.from({ length: 8 }, () => paragraph(4 + int(3))).join("\n\n");
    return `${image()}\n\n${sentence()}`;
  };
  const edit = (text: string) => {
    const r = rng();
    if (r < 0.35) return `${text}\n\n${sentence()}`;
    if (r < 0.55) return text.replace(/\/todo ([^\n~]+)/, (_m, x) => `~~/todo ${x}~~`);
    if (r < 0.7) return text.replace(/[A-Z][^.]*\./, sentence());
    if (r < 0.8) return `${text}\n- ${sentence()}`;
    if (r < 0.9) return `${text.split(" ").slice(0, -1).join(" ")} ${pick(TAILS)}.`;
    return `${text}\n\n${todoLine()}`;
  };
  const answer = () => `${paragraph(3)}\n\n- ${sentence()}\n- ${sentence()}`;

  const firstContent: string[] = [];
  const lastContent: string[] = [];
  for (const [idx, n] of notes.entries()) {
    let text = "";
    if (n.kind === "copy") text = firstContent[n.copyOf] as string;
    else if (n.assistant) text = answer();
    else {
      text = shape();
      if (chance(0.06)) text += `\n\nSee ${ref()}.`;
    }
    firstContent.push(text);
    let parent: string | null = null;
    for (const [k, vid] of n.vids.entries()) {
      if (k > 0) text = n.assistant ? answer() : edit(text);
      c.note_versions.push({
        id: vid,
        note_id: n.id,
        parent_id: parent,
        content: text,
        author: n.assistant ? "assistant" : "user",
        created_at: n.vtimes[k] as number,
        rev: null,
      });
      parent = vid;
    }
    lastContent[idx] = text;
  }

  // -- entities and placements
  const deletedNote = new Set<number>();
  const liveMsgs: { id: string; thread: number; noteIdx: number; created: number; removed: boolean }[] = [];
  const messageRow = (id: string, ti: number, noteIdx: number, created: number, primary: boolean, multi: boolean) => {
    const n = notes[noteIdx] as NoteSk;
    const t = threads[ti] as ThreadSk;
    let removedAt: number | null = null;
    if (chance(0.03)) {
      removedAt = Math.min(NOW - HOUR, created + rng() * 5 * DAY_MS + 60_000);
      bump(t, removedAt);
      if (primary && !multi && chance(0.4)) deletedNote.add(noteIdx);
    }
    const pin = chance(0.015) && n.vids.length > 1 ? (n.vids[0] as string) : null;
    c.entities.push({
      id,
      kind: "message",
      created_at: created,
      updated_at: removedAt ?? created,
      deleted_at: removedAt,
      rev: null,
    });
    c.messages.push({
      id,
      thread_id: t.id,
      note_id: n.id,
      pin_version_id: pin,
      updated_at: removedAt ?? created,
      removed_at: removedAt,
      rev: null,
    });
    liveMsgs.push({ id, thread: ti, noteIdx, created, removed: removedAt !== null });
  };
  const multiNotes = new Set(extraMsgs.map((m) => m.noteIdx));
  for (const [ti, t] of threads.entries())
    for (const m of t.msgs) {
      const isExtra = extraMsgs.some((x) => x.id === m.id);
      messageRow(m.id, ti, m.noteIdx, m.created, !isExtra, multiNotes.has(m.noteIdx));
    }

  // Deleted threads (only quiet ones, so the delete stamp stays in the past) and pool notes.
  const deletedThread = new Map<string, number>();
  for (const t of threads) if (t.upd <= NOW - 10 * DAY_MS && chance(0.08)) deletedThread.set(t.id, t.upd + DAY_MS);
  const deletedPool = new Set<number>();
  for (const [i, n] of notes.entries()) if (n.kind === "pool" && chance(0.06)) deletedPool.add(i);

  for (const [idx, n] of notes.entries()) {
    const last = n.vtimes[n.vtimes.length - 1] as number;
    const dead = deletedNote.has(idx) || deletedPool.has(idx);
    const deletedAt = dead ? Math.min(NOW - HOUR, last + rng() * 3 * DAY_MS + 60_000) : null;
    c.entities.push({
      id: n.id,
      kind: "note",
      created_at: n.created,
      updated_at: deletedAt ?? last,
      deleted_at: deletedAt,
      rev: null,
    });
  }
  for (const t of threads) {
    const created = Math.min(t.start, t.first) - int(30) * 60_000 - 60_000;
    const deletedAt = deletedThread.get(t.id) ?? null;
    c.entities.push({
      id: t.id,
      kind: "thread",
      created_at: created,
      updated_at: deletedAt ?? t.upd,
      deleted_at: deletedAt,
      rev: null,
    });
    c.threads.push({
      id: t.id,
      title: `${pick(TOPICS)} ${pick(ASPECTS)}`,
      updated_at: t.upd,
      rev: null,
    });
    if (chance(0.15)) {
      // a manual reorder: chronological with a few swaps
      const ids = t.msgs
        .slice()
        .sort((a, b) => a.created - b.created)
        .map((m) => m.id);
      for (let s = 0; s < 1 + int(3) && ids.length > 1; s++) {
        const i = int(ids.length);
        const j = int(ids.length);
        [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
      }
      c.thread_order.push({ thread_id: t.id, message_ids: JSON.stringify(ids), updated_at: t.upd, rev: null });
    }
  }

  // -- links: related, attached, copiedFrom
  const linkEntity = (id: string, at: number) =>
    c.entities.push({ id, kind: "link", created_at: at, updated_at: at, deleted_at: null, rev: null });
  const addValue = (setId: string, target: string, value: string | null, at: number) => {
    const removed = chance(0.05) ? Math.min(NOW - HOUR, at + DAY_MS) : null;
    c.property_values.push({
      id: uuid(),
      set_id: setId,
      target_id: target,
      value,
      created_at: at,
      updated_at: removed ?? at,
      removed_at: removed,
      rev: null,
    });
  };

  const hubs = Array.from({ length: 5 }, () => notes[int(nThread)] as NoteSk);
  const nLinks = Math.round(target.notes * 0.12);
  const typeSet = uuid();
  for (let i = 0; i < nLinks; i++) {
    const from = notes[int(nThread)] as NoteSk;
    const roll = rng();
    let toId: string;
    let pin: string | null = null;
    let at = from.created;
    if (roll < 0.15) {
      const t = pick(threads);
      toId = t.id;
      at = Math.max(at, t.start);
    } else {
      const to = chance(0.15) ? pick(hubs) : (notes[int(nThread)] as NoteSk);
      if (to === from) continue;
      toId = to.id;
      at = Math.max(at, to.created);
      if (chance(0.25))
        pin = to.vids.length > 1 && chance(0.6) ? (to.vids[0] as string) : (to.vids[to.vids.length - 1] as string);
    }
    at = Math.min(END_MAX, at + Math.floor(rng() * 3 * DAY_MS) + 1000);
    const id = uuid();
    linkEntity(id, at);
    c.links.push({ id, from_id: from.id, to_id: toId, pin_version_id: pin, updated_at: at, rev: null });
    if (chance(0.6)) addValue(typeSet, id, pick(LINK_TYPES), at);
  }
  for (const a of attachedTargets) {
    const host = notes[a.msgIdx] as NoteSk;
    if (!host.msgId) continue;
    const id = uuid();
    linkEntity(id, a.note.created);
    c.links.push({
      id,
      from_id: a.note.id,
      to_id: host.msgId,
      pin_version_id: null,
      updated_at: a.note.created,
      rev: null,
    });
    addValue(BUILTIN.attached, id, null, a.note.created);
  }
  for (const n of notes) {
    if (n.kind !== "copy" || !n.msgId) continue;
    const src = notes[n.copyOf] as NoteSk;
    const id = uuid();
    linkEntity(id, n.created);
    c.links.push({
      id,
      from_id: n.id,
      to_id: src.id,
      pin_version_id: src.vids[0] as string,
      updated_at: n.created,
      rev: null,
    });
    addValue(BUILTIN.copiedFrom, id, null, n.created);
  }

  // -- property sets and values
  const setAt = NOW - SPAN_DAYS * DAY_MS;
  const sets: {
    id: string;
    name: string;
    type: "none" | "text" | "number" | "date";
    rule?: "counter";
    slot: number;
  }[] = [
    { id: uuid(), name: "Status", type: "text", slot: 1 },
    { id: uuid(), name: "Area", type: "text", slot: 2 },
    { id: uuid(), name: "Priority", type: "number", slot: 3 },
    { id: uuid(), name: "Due", type: "date", slot: 4 },
    { id: uuid(), name: "Idea", type: "none", slot: 5 },
    { id: uuid(), name: "Question", type: "none", slot: 6 },
    { id: uuid(), name: "Step", type: "none", rule: "counter", slot: 7 },
    { id: typeSet, name: "Link type", type: "text", slot: 8 },
  ];
  const addSet = (s: (typeof sets)[number], scope: string | null, at: number) => {
    c.entities.push({ id: s.id, kind: "property_set", created_at: at, updated_at: at, deleted_at: null, rev: null });
    c.property_sets.push({
      id: s.id,
      name: s.name,
      value_type: s.type,
      scope_thread_id: scope,
      rule: s.rule ?? null,
      color_slot: s.slot,
      updated_at: at,
      rev: null,
    });
  };
  for (const s of sets) addSet(s, null, setAt);
  const [status, area, priority, due, idea, question, step] = sets as [
    (typeof sets)[number],
    (typeof sets)[number],
    (typeof sets)[number],
    (typeof sets)[number],
    (typeof sets)[number],
    (typeof sets)[number],
    (typeof sets)[number],
  ];

  for (const m of liveMsgs) {
    if (m.removed) continue;
    const at = Math.min(END_MAX, m.created + 1000 + int(HOUR));
    if (chance(0.22)) {
      const a = int(AREAS.length);
      addValue(area.id, m.id, AREAS[a] as string, at);
      addValue(status.id, m.id, STATUSES[(a + int(2)) % STATUSES.length] as string, at);
      if (chance(0.5)) addValue(priority.id, m.id, String(1 + int(3)), at);
      if (chance(0.3)) addValue(due.id, m.id, new Date(m.created + int(30) * DAY_MS).toISOString().slice(0, 10), at);
    }
    if (chance(0.04)) addValue(idea.id, m.id, null, at);
    if (chance(0.03)) addValue(question.id, m.id, null, at);
    if (chance(0.05)) addValue(BUILTIN.source, notes[m.noteIdx]?.id as string, "voice", at);
    // explicit todo rows (the `/todo` lines live in note content)
    if (chance(0.08)) {
      const done = chance(0.45);
      const doneAt = done ? Math.min(END_MAX, m.created + rng() * 20 * DAY_MS) : m.created;
      c.todos.push({ target_id: m.id, done: done ? 1 : 0, updated_at: doneAt, rev: null });
    }
  }
  for (const t of threads) {
    if (chance(0.03)) addValue(BUILTIN.localOnly, t.id, null, t.start);
    if (chance(0.15)) addValue(area.id, t.id, pick(AREAS), t.start + HOUR);
  }
  // thread-scoped counter sets on a handful of busy threads, values on consecutive messages
  const busy = threads.filter((t) => t.msgs.length >= 6).slice(0, Math.max(2, Math.round(target.threads / 100)));
  for (const t of busy) {
    const s = { id: uuid(), name: "Chapter", type: "none" as const, rule: "counter" as const, slot: 1 + int(8) };
    addSet(s, t.id, t.start);
    for (const m of t.msgs
      .slice()
      .sort((a, b) => a.created - b.created)
      .slice(0, 12))
      addValue(s.id, m.id, null, Math.min(END_MAX, m.created + 1000));
  }
  const counted = threads.filter((t) => t.msgs.length >= 4).slice(0, Math.max(2, Math.round(target.threads / 50)));
  for (const t of counted)
    for (const m of t.msgs.slice().sort((a, b) => a.created - b.created))
      addValue(step.id, m.id, null, Math.min(END_MAX, m.created + 1000));

  return c;
};
