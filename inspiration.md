# Threadz inspiration

Research notes for future iterations. **Nothing here is decided or scheduled**; the backlog is `backlog.md`.
Collected 2026-09-21 from web pages, docs and READMEs. Pages were read through a summarising fetch tool, so treat
details as leads to verify, not quotes. None of the apps below was run. Sources are listed at the end, marked
*read* (fetched page) or *snippet* (search result only).

## What the notes serve

Replace Obsidian and chat apps with an AI-first, private, local thread log; detect recurring themes ("similar to x");
capture on a walk without opening several apps. Main is the brain and does all heavy work; phones are shadow clones
that capture and merge back. Models and the phone-to-main transport are undecided (see `README.md`).

## Similar projects

- **Reor** (local AI notes desktop app). Same thesis: local-first, Ollama, related notes by embeddings. Notes are
  chunked and embedded (Transformers.js, LanceDB); a sidebar shows related chunks, and the same index answers Q&A
  ("a RAG app with two generators: the LLM and the human"). Archived 7 Mar 2026 at 8.6k stars; no public reason
  found. Unsourced guess: it competed as an Obsidian-like editor, with no capture story and no phone.
- **Smart Connections** (Obsidian plugin). Embeds every note and every block, shows a per-block badge with the count
  of strong matches while you write, optional rerank stage. Lesson: chunk-level vectors, surfaced at the moment of
  writing.
- **Khoj**. Alive (37k stars, AGPL). Server plus database; clients for Obsidian, Emacs, web, desktop, phone,
  WhatsApp; agents, scheduled automations with notifications, deep research, image generation, TTS. It indexes files
  owned by other apps, so it does not own capture, and its phone is a thin client to a reachable server. Lesson: push
  (automations) is the durable part; sprawl is the cost of not owning the notes.
- **Mem**. Reviews (user and review sites) complain about unreliable AI search and weak exact-keyword search. Lesson:
  hybrid search (keyword plus semantic), and keep every automatic action visible and undoable.
- **mymind**. No folders, AI auto-tagging, optional "Spaces" used sparingly.

## Zulip: topics instead of folders

Zulip's answer to folders is two flat levels and cheap relabelling.

- **Channel then topic.** Channels are coarse and few; topics are fine-grained and free to create. Topics never nest.
  Zulip later added channel folders, but only to group channels (secondary layer, per-user toggle): a manual coarse
  level tends to accrete structure.
- **Topic-less capture is allowed.** A message without a topic goes to "general chat"; admins can require topics.
- **One structural primitive.** The update-message API changes a message's topic (or channel) with `propagate_mode`:
  `change_one`, `change_later` (this message and everything after: a split), `change_all` (rename the topic; renaming
  into an existing name merges, as I understand it, not confirmed in the pages read). That reads as a topic being a
  per-message label, not a container; this is my reading of the API, not a doc statement.
- **Breadcrumbs.** A move can post an automatic "moved from/to" notice (default on for the new topic, off for the old).
- **Links survive.** Links to a topic or message (`#**channel>topic@msgid**`) keep working after rename, move or
  resolve: references go by id.
- **Status in the label.** Resolving prepends a ✔ to the topic name; filters like `is:unresolved` use it.
- **Move limits** for non-admins (time-based) guard against rewriting history.
- **Naming culture.** Specific names ("issue #1234"), renamed when the conversation drifts.
- **AI topic summaries** (beta in 10.x, opt-in). Zulip's docs say over 90% of tokens are input and mid-size (~70B)
  models were considerably better as of early 2025. Summarising a long thread is a large-context task, unlike
  embeddings.
- Missing for threadz: no branching (a topic is a flat sequence; a split *moves* messages), a message lives in
  exactly one topic, changes are edits on one central server (not merge-safe across offline devices).

## Branching conversations elsewhere

- **Forky**: git-style DAG for LLM chats (fork, merge, checkout). **Nodea**: two tables, projects and nodes; the
  visible conversation is the path from the root to the selected node. **LangGraph**: `forkFrom` starts a new
  execution path from a point. **Conversation Tree Architecture** (arXiv 2603.21278): rooted tree, each node has its
  own context window, a child inherits its parent's context at the fork; merge back is `ψ↑`. Open problems named by
  the paper: what to pass down, how much to compress, where merged content lands. Prototype only does full context or
  blank slate; no evaluation yet.
- Everyone gives messages a parent. Nobody in this list has settled merging.
- In-thread branching (one tree per conversation, a switcher at the fork) is the common LLM-chat pattern: editing a
  message or regenerating a reply creates a sibling branch and keeps the original (Nodea).

## Commands: a content primitive (2026-09-23)

Prompted by an unplanned Todos view landing (`a5fc9a0`, read-only, plain `- [ ] ` scan) — the user liked the
result but not as a standalone todo app; the insight worth keeping is treating a todo as one instance of a
general "command" written inline in a note, not a separate feature. Researched how other tools attach state to
inline text before settling this: GitHub/GitLab task lists and Logseq's `TODO`/`DOING`/`DONE` keyword both keep
the checkbox/keyword as the single source of truth (toggling rewrites the text, nothing else is authoritative);
Obsidian's Tasks plugin appends trailing emoji-metadata after the checkbox (the "pass args" idea below, already
proven); Roam gives blocks stable ids for cross-graph reference; Notion's `/` is the odd one out — it inserts a
structured block into non-markdown storage, the opposite of this app's plain-portable-markdown premise, so it's
the trigger character, not the model, that threadz borrows from Notion.

**Settled for v1** (see `backlog.md`): `@/<word> <rest of line>` — a command at the start of a line, content is
everything after the space to end of line. `@` was free to take (grepped, nothing else in the app treats it as a
trigger). Only `todo` exists today; the parser is written so a second command is a small diff, not a framework —
no plugin registry until there is a second command that needs one.

**Todo is the first command, and it's still text-is-truth.** `@/todo write more docs` is open;
`~~@/todo write more docs~~` is closed — real markdown strikethrough, so it degrades to something sane in any
plain markdown viewer, and the state has nowhere to drift out of sync with the text because there is no second
copy of it. Ticking a box in the sidebar rewrites the line and calls the same `editMessage` every other edit
uses; typing `~~` by hand does the same thing on the next parse. This is deliberately the GitHub/Logseq model,
not a new one.

**No backend table for todos**, reversing what was floated in conversation — every device already holds the
full replica (`lib/local.ts`'s `exportSnapshot`, kept warm by `pullMain`), so a derived index would be a second
copy of the same truth to keep consistent for no win at today's scale. Revisit only if a backend-only client
ever exists (none planned — see "main is the brain, phones are shadow clones" in README).

## Ideas that came out (candidates)

- **Two planes.** Content (notes, edits, images, thread membership; written anywhere; union merge) and derived
  (embeddings, neighbours, themes, digest, open loops, proposals; written only by main, rebuildable, shipped read-only
  to the phone the way description/tags already are). AI features cannot cause merge conflicts, swapping a model is
  rebuild-compare-discard, and the phone shows precomputed answers with no LLM.
- **Nightly "dream" pass on main** (Letta calls this sleep-time compute: background agents share memory with the
  primary agent and consolidate, dedupe, find patterns between conversations). Output as one card: filing/merge
  proposals (undoable), themes with counts against last month, stale open loops, one old note resurfaced against
  this week, and **then vs now** ("in March you wrote X, this week the opposite"; only a timestamped append-only log
  can do this).
- **Theme detection recipe** (standard, from search snippets): embed, cluster (HDBSCAN needs no preset k), label
  clusters with an LLM afterwards; a cluster is not a label. Re-run per time window to see trends.
- **Resurfacing beats browsing.** Readwise's daily review resurfaces by a decaying recall probability, not by date.
- **Per-thread `local-only` flag**: those threads only go to Ollama on main, never to Claude; makes "100% local"
  granular.
- **Ask as a participant** in any thread, and "ask the archive" with citations back to notes.
- **Chat exports** (ChatGPT/Claude JSON) roughly match the message model: a one-off script, like an Obsidian copy.
- **Eval before choosing models.** ~200 real notes, ~40 hand-labelled "same thing" pairs and ~10 look-alikes; recall@5
  for whole-thread vs per-note vs chunk embeddings, with and without the generated description in the embedding
  input, 2-3 embedding models. Similarity is decided by embedding model and granularity; the generative model only
  names things.
- **Hybrid search**: SQLite FTS5 first, semantic fallback with the same embeddings.

## Design leanings so far (from the conversation, not decided)

- No folder hierarchy; a thread is an unopinionated container that gets its meaning from what is in it. Zulip's
  channel+topic UI is not wanted; single threads that keep growing are. A tree view of branching threads that link
  back is a possible future.
- **Three different actions** (terminology settled 2026-09-21; an earlier "fork" here meant Copy):
  - **Copy.** On A:N, create thread B as an identical copy of A up to and including N, new UUIDs, A untouched, no
    pointers or shared state. In the backlog.
  - **Branch (with pointers).** On A:N, create thread B that starts from A:N. Messages up to N belong to A: B cannot
    edit them, and changes in A show in B.
  - **Branch as sub-thread.** No new thread: a sub-thread inside A starting from A:N, shown as a toggle on A:N that
    switches branches.
  - Plan so far: Copy first; real branching later instead of duplicating content.
- Threads never include each other and never share state; only copies.

## Ideas parked for later

Not in the backlog. Draw from here when picking the next features.

- **Branching, both kinds.** One model could serve both: every message gets a parent pointer, and the owning thread
  stays as it is. A sub-thread branch is a new branch owned by A; a cross-thread branch is a new branch owned by B
  whose ancestors in A are read-only. Roughly git's model. Build sub-thread first: it is the common LLM-chat pattern
  (edit or regenerate makes a sibling branch), edits to A:3 show in every branch through it because it is the same
  message, and it needs no cross-thread rules. Cross-thread adds: sync order (A before B, and a device holding B must
  also hold A), a rule for deleting A (e.g. B turns into a copy at that moment), read-only ancestors, and a parent
  pointer instead of `seq` to define "up to N" (concurrent appends can tie on `seq` and change a prefix). Adding the
  parent pointer later is a migration that fills it from `seq`.
- **Provenance for Copy.** Inert `copiedFrom` (per message) and `forkedFrom` (per thread), read only by the derived
  layer to collapse near-duplicates in search and trend detection and to draw a branch tree. They cannot be back-filled
  for copies made before they exist. Pointer branches would make them unnecessary.
- **Annotation extensions.** AI feedback as an annotation ("ask about this message" adds an assistant annotation on
  it, not a reply at the end of the thread). **Staleness citations:** an annotation may cite a range of messages
  (e.g. A0-A5) with a hash of it, only to show "the source changed since" (unchanged / changed / gone): a
  last-edited/hash lookup, not a message flow. The W3C Web Annotation model records what the target looked like when
  annotated (TimeState) so an application can compare later; the model does not detect change itself. Copies would
  remap citations inside the copied part and leave the rest pointing at the original.
- **Details view for AI metadata.** Show it with the open thread, not in the list: a sheet from the thread header on
  phones, a side panel on wide screens. A drawer rising from the bottom of the sidebar (the first idea) cannot work on
  phones, because the sidebar is hidden while a thread is open (`App.tsx`). Related threads, themes, copies and an
  annotation index could live there too.
- **Tags.** Skipped until there are 20+ threads. If revived: one list, each tag with a source (user or AI), looking the
  same (at most a small icon); AI regeneration replaces only the AI tags. The generator writes the whole `tags`
  column after each append, so a tag typed into that column would be lost, hence the source flag. User tags are
  content: they would have to sync up (the sync payload carries no tags), count towards the thread hash (tags and
  description are excluded now) and merge like the title (newest wins).
- **Stream-first home.** One feed of every note, newest first, composer at the bottom, a thread chip on each note;
  Threads, Themes and Open become views, not places. A note lands in an Inbox and gets a thread later, or a thread is
  created on the first sent note instead of on `+`.
- **What folders did, and what could replace it:** finding (hybrid search plus "you wrote about this before"),
  scoping (pinned threads, a focus filter), active vs archive (heat decay instead of filing), nesting (nothing).
- **From Zulip, if needed:** links by message id that survive changes; a breadcrumb when content moves; status as a
  label (settled / open) with an "unresolved" filter. Zulip's move maps to copy plus delete here, which loses
  id-based links unless a redirect is kept.
- **MCP server on main only** (a stdio process reading the SQLite file), not on the phone and not a backend.
- **One-off import scripts** for an Obsidian vault (folder names could seed theme hints) and for ChatGPT/Claude
  exports; personal scripts, not features.
- **Undo toast for Copy**, if Copy ever gets an always-visible button.
- **A gutter, VS Code-style.** Floated 2026-09-23 feedback on the `@/todo` checkbox reading as UI bolted onto
  markdown (see `backlog.md`): instead of decorating text inline, a thin action rail down the left of a message
  could host a todo checkbox, the note (`StickyNote`) trigger, and whatever else wants a per-message affordance
  without touching the markdown flow itself. Real reuse potential — one rail, several features — but real
  layout work (every message row gains a fixed-width column, interacts with the virtualizer's row measurement).
  Not started; the checkbox went CSS-only instead for now.
- **Commands beyond `@/todo`.** Multi-line snapshot todos (capture everything until the next blank line or command,
  not just to end-of-line). Args after the command for alternate interpretation (`@/todo(summarize)` runs the note
  below through `askModel()` so the sidebar shows a clean line instead of raw text; `@/todo(image)` pulls in the
  nearest image). Both need a real second data point (people actually wanting longer todos, or wanting the noise
  cut) before building — the flat one-line command covers the common case cheaply today. Any second command type
  (not just todo) is also the trigger to build the small parser into an actual registry — not before.
  Inline checkbox rendering for `@/todo` in the Milkdown view (a remark + node-view plugin, same pattern as
  `imageView.ts`) is cosmetic polish, not required for the feature to work — the sidebar and raw edit mode already
  read/write it fine without it.

## Sources

Read (fetched page): [Reor](https://github.com/reorproject/reor) ·
[Khoj repo](https://github.com/khoj-ai/khoj) · [Khoj docs](https://docs.khoj.dev/) ·
[Zulip: introduction to topics](https://zulip.com/help/introduction-to-topics) ·
[Zulip: require topics](https://zulip.com/help/require-topics) ·
[Zulip: channel folders](https://zulip.com/help/channel-folders) ·
[Zulip: resolve a topic](https://zulip.com/help/resolve-a-topic) ·
[Zulip: link to a message or conversation](https://zulip.com/help/link-to-a-message-or-conversation) ·
[Zulip: move content to another topic](https://zulip.com/help/move-content-to-another-topic) ·
[Zulip API: update message](https://zulip.com/api/update-message) ·
[Conversation Tree Architecture (arXiv)](https://arxiv.org/html/2603.21278v1)

Snippet only (search result, page not read): [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) ·
[Mem reviews](https://www.saner.ai/blogs/mem-ai-reviews) · [mymind review](https://blog.saner.ai/mymind-reviews/) ·
[Letta sleep-time agents](https://docs.letta.com/guides/agents/architectures/sleeptime/) ·
[Zulip AI integrations](https://zulip.readthedocs.io/en/latest/production/ai-integrations.html) ·
[Readwise: reviewing highlights](https://docs.readwise.io/readwise/docs/faqs/reviewing-highlights) ·
[Forky](https://github.com/ishandhanani/forky) · [Nodea](https://nodea.ai/blog/branching-ai-chat-guide) ·
[LangChain branching chat](https://docs.langchain.com/oss/python/langchain/frontend/branching-chat) ·
[W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/) ·
[Text clustering and topic modeling](https://vizuara.substack.com/p/from-text-to-insights-hands-on-text)
