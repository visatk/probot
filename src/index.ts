import { Hono } from 'hono';
import { Env, QueuePayload } from './types';
import { handleWebhook } from './handlers/webhook';
import { DbRepository } from './db/repository';

const app = new Hono<{ Bindings: Env }>();

app.use('/webhook', async (c, next) => {
	if (c.req.header('X-Telegram-Bot-Api-Secret-Token') !== c.env.TELEGRAM_SECRET_TOKEN) {
		return c.text('Unauthorized', 401);
	}
	await next();
});

app.get('/health', (c) => c.json({ 
	status: 'healthy', 
	version: '2.5.0', 
	edge_region: c.req.raw.cf?.colo || 'unknown',
	timestamp: new Date().toISOString()
}));

app.post('/webhook', handleWebhook);

export default {
	fetch: app.fetch,

	// Telemetry Queue Processing
	async queue(batch: MessageBatch<QueuePayload>, env: Env, ctx: ExecutionContext): Promise<void> {
		if (batch.messages.length === 0) return;

		const stmt = env.DB.prepare(`INSERT INTO audit_logs (log_id, chat_id, user_id, action, metadata) VALUES (?1, ?2, ?3, ?4, ?5)`);
		
		for (const msg of batch.messages) {
			try {
				await stmt.bind(
					msg.body.logId, 
					msg.body.chatId, 
					msg.body.userId, 
					msg.body.action,
					msg.body.metadata ? JSON.stringify(msg.body.metadata) : null
				).run();
				msg.ack(); 
			} catch (error) {
				console.error(`Telemetry batch failed ${msg.id}:`, error);
				msg.retry(); 
			}
		}
	},

	// CRON triggers for Maintenance
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		const db = new DbRepository(env.DB);
		// Purge records older than 30 days to stay well within D1 limits
		ctx.waitUntil(db.cleanup(30));
	}
};
