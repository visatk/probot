import { Hono } from 'hono';
import { Env } from './types';
import { handleWebhook } from './handlers/webhook';

const app = new Hono<{ Bindings: Env }>();

// Security Middleware
app.use('/webhook', async (c, next) => {
	if (c.req.header('X-Telegram-Bot-Api-Secret-Token') !== c.env.TELEGRAM_SECRET_TOKEN) {
		return c.text('Unauthorized', 401);
	}
	await next();
});

// Setup & Health Endpoints
app.get('/health', (c) => c.json({ status: 'healthy', version: '2.0.0', edge_region: c.req.raw.cf?.colo }));

// Core Routing
app.post('/webhook', handleWebhook);

export default {
	fetch: app.fetch,

	// Queue Consumer with Dead Letter Handling Logic
	async queue(batch: MessageBatch<any>, env: Env, ctx: ExecutionContext): Promise<void> {
		if (batch.messages.length === 0) return;

		const stmt = env.DB.prepare(`INSERT INTO audit_logs (log_id, chat_id, user_id, action) VALUES (?1, ?2, ?3, ?4)`);
		
		for (const msg of batch.messages) {
			try {
				await stmt.bind(msg.body.logId, msg.body.chatId, msg.body.userId, msg.body.action).run();
				msg.ack();
			} catch (error) {
				console.error(`Failed to process message ${msg.id}:`, error);
				// Calling msg.retry() signals the runtime to push it to the DLQ if max retries 
				// are exceeded (configured in wrangler.jsonc). 
				msg.retry(); 
			}
		}
	}
};
