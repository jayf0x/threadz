import { z } from "zod";

// Request bodies. Zod only adds "wrong TYPE -> 400"; "field missing" stays with the
// handlers' own checks, so the fields they check are optional here.

export const Role = z.enum(["user", "assistant"]);
export type Role = z.infer<typeof Role>;

const Version = z.object({ content: z.string(), at: z.number() });

export const SyncPayload = z.object({
  threads: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        createdAt: z.number().optional(),
        renamedAt: z.number().nullish(),
      }),
    )
    .default([]),
  messages: z
    .array(
      z.object({
        id: z.string(),
        threadId: z.string(),
        role: Role.optional(),
        content: z.string(),
        meta: z.unknown().optional(),
        createdAt: z.number().optional(),
        editedAt: z.number().nullish(),
        edits: z.array(Version).optional(),
      }),
    )
    .default([]),
  // Same fields as a message minus `role`, plus the thread/message it belongs to.
  annotations: z
    .array(
      z.object({
        id: z.string(),
        threadId: z.string(),
        messageId: z.string(),
        content: z.string(),
        createdAt: z.number().optional(),
        editedAt: z.number().nullish(),
        edits: z.array(Version).optional(),
      }),
    )
    .default([]),
  // Delete only if the thread is still exactly what the device last saw (`baseHash`).
  deletes: z.array(z.object({ id: z.string(), baseHash: z.string() })).default([]),
  // Same idea as `deletes`, scoped to one annotation: `baseVersion` is the device's last-known
  // editedAt ?? createdAt for that row.
  annotationDeletes: z.array(z.object({ id: z.string(), baseVersion: z.number() })).default([]),
});
export type SyncPayload = z.infer<typeof SyncPayload>;

export const CreateThread = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  seed: z.string().optional(),
  createdAt: z.number().optional(),
});

export const AppendMessage = z.object({
  id: z.string().optional(),
  role: Role.optional(),
  content: z.string().optional(),
  meta: z.unknown().optional(),
  createdAt: z.number().optional(),
});

export const RenameThread = z.object({ title: z.string().optional(), renamedAt: z.number().optional() });

export const EditMessage = z.object({ content: z.string().optional(), editedAt: z.number().optional() });

export const AskThread = z.object({
  prompt: z.string().optional(),
  commit: z.boolean().optional(),
  userMessageId: z.string().optional(),
  assistantMessageId: z.string().optional(),
});

export const CopyThread = z.object({
  newThreadId: z.string().optional(),
  uptoMessageId: z.string().optional(),
  appendNote: z.object({ id: z.string(), content: z.string(), createdAt: z.number().optional() }).optional(),
});

export const CreateAnnotation = z.object({
  id: z.string().optional(),
  content: z.string().optional(),
  createdAt: z.number().optional(),
});

export const EditAnnotation = z.object({ content: z.string().optional(), editedAt: z.number().optional() });
