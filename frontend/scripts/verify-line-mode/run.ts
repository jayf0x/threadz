// Headless end-to-end check for line mode (Wave 6 phase 2, docs/direction.md "Round 6"): a
// per-thread ⋯ menu toggle that renders a thread's messages as one continuous document instead of
// chat bubbles. Not part of the app, its build, or `bun test` — run manually with:
//
//   bun run frontend/scripts/verify-line-mode/run.ts
//
// Same shape as ../verify-phone-db/run.ts: a real Vite dev server (the app's own config, so the
// whole app boots exactly as it does in `bun run dev:frontend`) and a real, iPhone-sized headless
// Chromium — real `ContentField`/`MarkdownEditor` (Milkdown/ProseMirror), real phone db (a real
// Worker + `@subframe7536/sqlite-wasm` + IndexedDB), real Radix menu. Seeds a thread directly
// through `lib/data.ts` (the same path the composer itself writes through) rather than typing into
// the composer, since only the toggle and the two render modes are under test here.
import { chromium, devices } from "playwright";
import { createServer } from "vite";

const PORT = 8994;
const FRONTEND_ROOT = new URL("../../", import.meta.url).pathname;

async function main() {
  const server = await createServer({ root: FRONTEND_ROOT, server: { port: PORT } });
  await server.listen(PORT);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.error(`[browser error] ${err}`));

    // Seed a thread with a user message and an assistant reply, then open it directly via
    // `?thread=` (App.tsx's deep-link entry) — the same URL a todo jump or a reference click lands
    // on, no UI navigation needed to get there.
    // First load triggers Vite's dependency (re-)optimization for the phone db's worker deps
    // (@subframe7536/sqlite-wasm), which reloads the page out from under an in-flight `evaluate` —
    // load once to let that settle, then reload before actually seeding.
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForLoadState("networkidle");
    await page.reload();
    await page.waitForLoadState("networkidle");
    const threadId = await page.evaluate(async () => {
      const { createThread, appendNote } = await import("/src/lib/data.ts");
      const t = await createThread("Line mode check");
      await appendNote(t.id, "# First heading\n\nA paragraph from me.", "user");
      await appendNote(t.id, "A reply from Claude.", "assistant");
      return t.id;
    });
    await page.goto(`http://localhost:${PORT}/?thread=${threadId}`);

    // Chat mode (the default): both messages render as EntryRow bubbles, each its own <article>.
    await page.waitForSelector("article");
    const chatArticles = await page.locator("article").count();
    assertEq(chatArticles, 2, "chat mode: two EntryRow <article> bubbles");
    await page.getByText("A paragraph from me.").waitFor();
    await page.getByText("A reply from Claude.").waitFor();

    // Open the thread header's ⋯ menu and switch to line mode.
    await page.getByRole("button", { name: "Thread actions" }).click();
    await page.getByRole("menuitem", { name: "Line mode" }).click();

    // Line mode: no <article> chrome, but the same content renders as flowing text.
    await page.waitForFunction(() => document.querySelectorAll("article").length === 0);
    await page.getByText("First heading").waitFor();
    await page.getByText("A paragraph from me.").waitFor();
    await page.getByText("A reply from Claude.").waitFor();
    // No per-message avatar/timestamp chrome (EntryRow's "Claude" label, absent from LineEntry).
    assertEq(await page.getByText("Claude", { exact: true }).count(), 0, "line mode: no avatar label");

    // Edit-in-place still works: click your own message's text, it turns into a live ContentField.
    await page.getByText("A paragraph from me.").click();
    await page.waitForSelector('[data-variant="edit"]:not(.border-transparent)');
    await page.getByRole("button", { name: "Cancel" }).click();

    // Toggle back to chat mode.
    await page.getByRole("button", { name: "Thread actions" }).click();
    await page.getByRole("menuitem", { name: "Chat mode" }).click();
    await page.waitForFunction(() => document.querySelectorAll("article").length === 2);

    console.log("\nPASS: line mode toggles from the ⋯ menu, renders the same messages with no");
    console.log("per-message chrome, keeps edit-in-place working, and toggles back to chat mode.");
  } catch (e) {
    console.error("\nFAIL:", e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    await server.close();
  }
}

function assertEq(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log(`  ok — ${label}`);
}

main();
