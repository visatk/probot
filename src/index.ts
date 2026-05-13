import { Hono } from 'hono';
import { Env } from './types';
import { handleWebhook } from './handlers/webhook';

const app = new Hono<{ Bindings: Env }>();

// Edge Security Middleware: Validates payloads originate exclusively from Telegram
app.use('/webhook', async (c, next) => {
	if (c.req.header('X-Telegram-Bot-Api-Secret-Token') !== c.env.TELEGRAM_SECRET_TOKEN) {
		console.warn("Unauthorized webhook invocation attempt detected.");
		return c.text('Unauthorized', 401);
	}
	await next();
});

// Setup & Operational Health Endpoint
app.get('/health', (c) => c.json({ 
	status: 'healthy', 
	version: '2.1.0', 
	edge_region: c.req.raw.cf?.colo || 'unknown',
	timestamp: new Date().toISOString()
}));

// Core Routing Pipeline
app.post('/webhook', handleWebhook);

export default {
	fetch: app.fetch,

	// Asynchronous Telemetry Consumer
	async queue(batch: MessageBatch<any>, env: Env, ctx: ExecutionContext): Promise<void> {
		if (batch.messages.length === 0) return;

		const stmt = env.DB.prepare(`INSERT INTO audit_logs (log_id, chat_id, user_id, action) VALUES (?1, ?2, ?3, ?4)`);
		
		for (const msg of batch.messages) {
			try {
				await stmt.bind(msg.body.logId, msg.body.chatId, msg.body.userId, msg.body.action).run();
				msg.ack(); // Explicitly clear from queue on success
			} catch (error) {
				console.error(`Failed to process telemetry batch ${msg.id}:`, error);
				// Triggers Cloudflare's internal exponential backoff and DLQ routing
				msg.retry(); 
			}
		}
	}
};
