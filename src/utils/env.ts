import { z } from 'zod';

const zodEnv = z.object({
  X_PARSE_APPLICATION_ID: z.string(),
  X_PARSE_MASTER_KEY: z.string(),
  X_PARSE_REST_API_KEY: z.string(),
  API_URL: z.string(),
  STRIPE_SUBSCRIBE_PRICE_ID: z.string(),
  STRIPE_WEBHOOK_SECRET: z.string(),
  STRIPE_PRIVATE_KEY: z.string(),
});

declare global {
  namespace NodeJS {
    interface ProcessEnv extends z.infer<typeof zodEnv> {}
  }
}

try {
  zodEnv.parse(process.env);
} catch (err) {
  if (err instanceof z.ZodError) {
    const { fieldErrors } = err.flatten();
    const errorMessage = Object.entries(fieldErrors)
      .map(([field, errors]) =>
        errors ? `${field}: ${errors.join(', ')}` : field
      )
      .join('\n  ');
    console.error(`Missing environment variables:\n  ${errorMessage}`);
    process.exit(1);
  }
}
