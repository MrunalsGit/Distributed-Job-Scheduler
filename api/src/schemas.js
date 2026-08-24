const { z } = require('zod');

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'password must be at least 8 characters'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
});

const createQueueSchema = z.object({
  name: z.string().min(1).max(200),
  priority: z.number().int().default(0),
  concurrencyLimit: z.number().int().positive().default(5),
  retryPolicyId: z.string().uuid().nullable().optional(),
});

const updateQueueSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  priority: z.number().int().optional(),
  concurrencyLimit: z.number().int().positive().optional(),
  retryPolicyId: z.string().uuid().nullable().optional(),
});

const createRetryPolicySchema = z.object({
  strategy: z.enum(['fixed', 'linear', 'exponential']),
  baseDelayMs: z.number().int().positive().default(1000),
  maxAttempts: z.number().int().positive().default(5),
});

const createJobSchema = z.object({
  type: z.enum(['immediate', 'delayed', 'scheduled', 'recurring', 'batch']),
  payload: z.record(z.any()).default({}),
  runAt: z.string().datetime().optional(),
  cronExpression: z.string().optional(),
  idempotencyKey: z.string().optional(),
  // Only used when type === 'batch' an array of payloads, one job per entry.
  items: z.array(z.record(z.any())).optional(),
});

module.exports = {
  signupSchema,
  loginSchema,
  createProjectSchema,
  createQueueSchema,
  updateQueueSchema,
  createRetryPolicySchema,
  createJobSchema,
};
