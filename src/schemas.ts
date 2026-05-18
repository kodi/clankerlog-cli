import { z } from "zod";
import { normalizeModelName } from "./model.js";

export const defaultIngestEndpoint = "https://ingest.clankerlog.ai/v1/clanks";

const isoDateTimeWithOffset =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const stackTagPattern = /^[a-z0-9][a-z0-9.+-]*$/u;

export const stackTagSchema = z
  .string()
  .trim()
  .min(1, "Stack tag cannot be empty")
  .max(64, "Stack tag must be 64 characters or less")
  .regex(
    stackTagPattern,
    "Stack tag must use lowercase letters, numbers, dots, pluses, or hyphens",
  );

export const stackSchema = z
  .array(stackTagSchema)
  .max(32, "Stack can include at most 32 tags")
  .default([]);

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Project display name is required")
  .max(120, "Project display name must be 120 characters or less");

export const allowedProjectSchema = z
  .object({
    displayName: displayNameSchema,
    path: z.string().trim().min(1, "Project path is required"),
  })
  .strict();

export const globalConfigSchema = z
  .object({
    allowedProjects: z.array(allowedProjectSchema).default([]),
    apiKey: z.string().trim().min(1).optional(),
    endpoint: z.url().optional(),
  })
  .strict()
  .default({ allowedProjects: [] });

export const projectConfigSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    stack: stackSchema.optional(),
  })
  .strict();

export const clankPayloadSchema = z
  .object({
    agent: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(120).transform(normalizeModelName),
    project: z
      .object({
        display_name: displayNameSchema,
      })
      .strict(),
    stack: stackSchema,
    timestamp: z.string().refine(isIsoDateTimeWithOffsetValue, {
      message: "Timestamp must be an ISO datetime with an offset",
    }),
    type: z.literal("clank"),
  })
  .strict();

export const ingestionSuccessSchema = z.looseObject({
  id: z.string().min(1),
  ok: z.literal(true),
});

export const authCheckSuccessSchema = z.looseObject({
  authenticated: z.literal(true),
  keyId: z.string().min(1),
  ok: z.literal(true),
});

export type AllowedProject = z.infer<typeof allowedProjectSchema>;
export type AuthCheckSuccess = z.infer<typeof authCheckSuccessSchema>;
export type ClankPayload = z.infer<typeof clankPayloadSchema>;
export type GlobalConfig = z.infer<typeof globalConfigSchema>;
export type IngestionSuccess = z.infer<typeof ingestionSuccessSchema>;
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

function isIsoDateTimeWithOffsetValue(value: string): boolean {
  return isoDateTimeWithOffset.test(value) && !Number.isNaN(Date.parse(value));
}
