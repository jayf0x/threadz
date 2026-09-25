// "Did the user change anything?" for an edit-in-place field. Milkdown re-serialises markdown
// (`* a` -> `- a`, `snake_case` -> `snake\_case`, spacing, trailing newline), so the stored text is
// never a valid baseline: the baseline is the editor's OWN `getMarkdown()` taken as editing begins,
// and both sides here have been through that same serialiser. Only whitespace at the ends of the
// document is forgiven (a trailing newline the serialiser adds or drops isn't an edit).
const settle = (markdown: string) => markdown.replace(/\r\n/g, "\n").trim();

export const isDirty = (baseline: string, current: string): boolean => settle(baseline) !== settle(current);
