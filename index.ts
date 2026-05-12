import { z } from 'zod';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const PlatformSchema = z.enum(['GMAIL', 'GOOGLE_CHAT']);
export type Platform = z.infer<typeof PlatformSchema>;

export const CategorySchema = z.enum([
  'SOCIAL',
  'INFORMATIONAL',
  'ACTIONABLE',
  'URGENT',
  'SENSITIVE',
]);
export type Category = z.infer<typeof CategorySchema>;

export const UrgencySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type Urgency = z.infer<typeof UrgencySchema>;

export const ApprovalStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SENT',
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const InterruptionLevelSchema = z.enum(['immediate', 'digest', 'none']);
export type InterruptionLevel = z.infer<typeof InterruptionLevelSchema>;

// ─── LLM Triage Result ────────────────────────────────────────────────────────

export const TriageResultSchema = z.object({
  category: z.enum(['social', 'informational', 'actionable', 'urgent', 'sensitive']),
  urgency: z.enum(['low', 'medium', 'high', 'critical']),
  confidence: z.number().min(0).max(1),
  requires_human: z.boolean(),
  summary: z.string().max(500),
  suggested_reply: z.string().nullable(),
  tasks: z.array(
    z.object({
      task: z.string(),
      deadline: z.string().nullable(),
    })
  ),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'urgent']),
  entities: z.object({
    people: z.array(z.string()),
    deadlines: z.array(z.string()),
    projects: z.array(z.string()),
  }),
  auto_handle: z.boolean(),
  interruption_level: InterruptionLevelSchema,
});

export type TriageResult = z.infer<typeof TriageResultSchema>;

// ─── Incoming Message (platform-agnostic) ─────────────────────────────────────

export const IncomingMessageSchema = z.object({
  externalId: z.string(),
  platform: PlatformSchema,
  sender: z.string(),
  subject: z.string().nullable(),
  body: z.string(),
  receivedAt: z.date(),
  threadId: z.string().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

export type IncomingMessage = z.infer<typeof IncomingMessageSchema>;

// ─── API Response Shapes ──────────────────────────────────────────────────────

export const MessageResponseSchema = z.object({
  id: z.string(),
  platform: PlatformSchema,
  sender: z.string(),
  subject: z.string().nullable(),
  body: z.string(),
  receivedAt: z.string(),
  triage: z
    .object({
      category: CategorySchema,
      urgency: UrgencySchema,
      confidence: z.number(),
      requiresHuman: z.boolean(),
      summary: z.string(),
      suggestedReply: z.string().nullable(),
      tasks: z.array(z.object({ task: z.string(), deadline: z.string().nullable() })),
      sentiment: z.string(),
      interruptionLevel: InterruptionLevelSchema,
      processingMs: z.number(),
    })
    .nullable(),
  approval: z
    .object({
      id: z.string(),
      status: ApprovalStatusSchema,
      draft: z.string(),
      editedDraft: z.string().nullable(),
    })
    .nullable(),
});

export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export const ApprovalActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  editedDraft: z.string().optional(),
});

export type ApprovalAction = z.infer<typeof ApprovalActionSchema>;

// ─── Queue Job Types ───────────────────────────────────────────────────────────

export const TriageJobSchema = z.object({
  messageId: z.string(),
  userId: z.string(),
  platform: PlatformSchema,
  retryCount: z.number().default(0),
});

export type TriageJob = z.infer<typeof TriageJobSchema>;

export const SendReplyJobSchema = z.object({
  approvalId: z.string(),
  userId: z.string(),
  platform: PlatformSchema,
  messageId: z.string(),
  draft: z.string(),
});

export type SendReplyJob = z.infer<typeof SendReplyJobSchema>;
