import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

// The one seam for model calls. A future Ollama/vLLM/Claude routing gateway
// replaces the body of askModel() and nothing else. Do not call a model from
// anywhere but this file.

const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";
// Haiku by default — a personal-brain thinking partner doesn't need Sonnet, and
// this keeps token cost low. Override with ANTHROPIC_MODEL.
export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
// qwen3.5:0.8b follows the JSON schema reliably; gemma3:270m dropped fields ~2/3
// of the time in testing. Override with THREADZ_GEN_MODEL.
const GEN_MODEL = process.env.THREADZ_GEN_MODEL || "qwen3.5:0.8b";
const EMBED_MODEL = process.env.THREADZ_EMBED_MODEL || "nomic-embed-text";

export type ChatMessage = { role: "user" | "assistant"; content: string };

// A fresh empty directory (created once) to run Claude in: never the repo or the home directory.
let sandbox: string | undefined;
const sandboxDir = () => {
  sandbox ??= mkdtempSync(join(tmpdir(), "threadz-claude-"));
  return sandbox;
};

/**
 * The model seam. v1 routes to Claude via the Claude Code SDK, which uses the
 * local `claude` CLI auth (subscription OAuth or ANTHROPIC_API_KEY) — no key
 * plumbing here. If it fails with an auth error, run `claude login` once.
 */
export const askModel = async (opts: { system?: string; messages: ChatMessage[] }): Promise<{ text: string }> => {
  const [only] = opts.messages;
  const prompt =
    only && opts.messages.length === 1
      ? only.content
      : `${opts.messages
          .map((m) => `${m.role === "assistant" ? "Claude" : "User"}: ${m.content}`)
          .join("\n\n")}\n\n---\nReply as Claude to the final User message above.`;

  let text = "";
  try {
    for await (const msg of query({
      prompt,
      options: {
        model: CLAUDE_MODEL,
        systemPrompt:
          opts.system ?? "You are a thinking partner inside a personal knowledge system. Be concise and concrete.",
        // The model must see only the thread text sent to it, never this device's files. `allowedTools`
        // is just an auto-approve list, so the sandbox is: no built-in tools, deny anything else, an
        // empty working directory, and none of the user's own Claude config (settings, MCP servers).
        tools: [],
        permissionMode: "dontAsk",
        cwd: sandboxDir(),
        settingSources: [],
        strictMcpConfig: true,
        mcpServers: {},
        maxTurns: 1,
        ...(process.env.CLAUDE_BIN ? { pathToClaudeCodeExecutable: process.env.CLAUDE_BIN } : {}),
      },
    })) {
      if (msg.type === "result") {
        if (msg.subtype !== "success") throw new HttpError(502, `model call failed: ${msg.subtype}`);
        text = msg.result;
      }
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, `model call failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { text };
};

/** Local small-model generation for tags/description. JSON-mode. */
export const ollamaGenerateJson = async <T>(prompt: string, system?: string): Promise<T> => {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // think:false — qwen3.5 is a reasoning model; its <think> blocks break format:"json".
    body: JSON.stringify({
      model: GEN_MODEL,
      prompt,
      system,
      stream: false,
      format: "json",
      think: false,
      options: { temperature: 0 },
    }),
  });
  if (!res.ok) throw new HttpError(502, `Ollama generate ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { response: string };
  return JSON.parse(data.response) as T;
};

/** Local embeddings. Prefix matters for nomic-embed-text. */
export const embed = async (texts: string[], kind: "document" | "query" = "document"): Promise<Float32Array[]> => {
  const prefix = kind === "query" ? "search_query: " : "search_document: ";
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts.map((t) => prefix + t) }),
  });
  if (!res.ok) throw new HttpError(502, `Ollama embed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { embeddings: number[][] };
  return data.embeddings.map((e) => Float32Array.from(e));
};

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
