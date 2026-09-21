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

- No folder hierarchy; a thread is an unopinionated container that gets meaning later through title and tags
  (generated or typed). Zulip's channel+topic UI is not wanted; single threads that keep growing are. A tree view of
  branching threads that link back is a possible future.
- **Fork = full copy.** Forking thread A at message N makes thread B a copy of A up to and including N, with new
  UUIDs; A is untouched. No pointers, no shared state, threads never include each other. Copies keep their original
  `createdAt` and other row properties; generated (AI) metadata is dropped from the copy and regenerated; all
  annotations are copied; B's title is `Copy: <original title>`.
- **Annotation staleness.** An annotation may cite a range of messages (e.g. A0-A5) with a hash of it, purely to show
  "the source changed since" (unchanged / changed / gone), a last-edited/hash lookup and not a message flow. The W3C
  Web Annotation model records what the target looked like when annotated (TimeState) so an application can compare
  later; the model does not detect change itself.
- Known side effect of copies: near-duplicate content in search and trend detection. Idea: inert provenance data
  (`copiedFrom` per message, `forkedFrom` per thread) that only the derived layer reads. Undecided.

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
