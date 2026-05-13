// src/index.ts
import { Hono } from 'hono';

// --- Bindings & Types ---
export interface Env {
	DB: D1Database;
	KV: KVNamespace;
	QUEUE: Queue;
	TELEGRAM_BOT_TOKEN: string;
	TELEGRAM_SECRET_TOKEN: string;
}

interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
}

interface TelegramMessage {
	message_id: number;
	from: { id: number; is_bot: boolean; first_name: string; username?: string };
	chat: { id: number; type: string; title?: string };
	date: number;
	text?: string;
	entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
}

interface AuditLogEvent {
	logId: string;
	chatId: number;
	userId: number;
	action: string;
}

// --- Application Initialization ---
const app = new Hono<{ Bindings: Env }>();

// --- Telegram API Helper ---
class TelegramClient {
	constructor(private token: string) {}

	async callApi(method: string, payload: any): Promise<Response> {
		return fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
	}

	async deleteMessage(chatId: number, messageId: number) {
		return this.callApi('deleteMessage', { chat_id: chatId, message_id: messageId });
	}

	async sendMessage(chatId: number, text: string) {
		return this.callApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
	}

	async banChatMember(chatId: number, userId: number, revokeMessages: boolean = true) {
		return this.callApi('banChatMember', { chat_id: chatId, user_id: userId, revoke_messages: revokeMessages });
	}

	async getChatAdministrators(chatId: number): Promise<number[]> {
		const res = await this.callApi('getChatAdministrators', { chat_id: chatId });
		if (!res.ok) return [];
		const data = await res.json() as any;
		return data.result.map((member: any) => member.user.id);
	}
}

// --- Core Webhook Router ---
app.post('/webhook', async (c) => {
	const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token');
	if (secretToken !== c.env.TELEGRAM_SECRET_TOKEN) {
		return c.text('Unauthorized', 401);
	}

	const update: TelegramUpdate = await c.req.json();
	if (!update.message) return c.text('OK'); // Acknowledge non-message updates

	const { message } = update;
	const { chat, from } = message;

	// Only process group or supergroup messages
	if (chat.type !== 'group' && chat.type !== 'supergroup') {
		return c.text('OK');
	}

	const tg = new TelegramClient(c.env.TELEGRAM_BOT_TOKEN);

	// 1. Threat Detection: Check for URLs or Mentions
	const hasLink = message.entities?.some(e => e.type === 'url' || e.type === 'text_link');
	
	if (hasLink && !from.is_bot) {
		// 2. Privilege Escalation Check: Is user an admin? 
		// Use KV for edge-caching Admin lists to avoid Telegram API rate limits.
		const cacheKey = `admins:${chat.id}`;
		let admins: number[] = await c.env.KV.get(cacheKey, 'json') || [];

		if (admins.length === 0) {
			admins = await tg.getChatAdministrators(chat.id);
			await c.env.KV.put(cacheKey, JSON.stringify(admins), { expirationTtl: 3600 }); // Cache for 1 hour
		}

		if (!admins.includes(from.id)) {
			// 3. Execution: Delete Malicious Content
			c.executionCtx.waitUntil(tg.deleteMessage(chat.id, message.message_id));

			// 4. State Management: Record Infraction in D1
			const result = await c.env.DB.prepare(`
				INSERT INTO user_infractions (user_id, chat_id, warnings) 
				VALUES (?1, ?2, 1) 
				ON CONFLICT(user_id, chat_id) 
				DO UPDATE SET warnings = warnings + 1, last_violation = CURRENT_TIMESTAMP
				RETURNING warnings;
			`).bind(from.id, chat.id).first<{ warnings: number }>();

			const warnings = result?.warnings || 1;

			// Fetch group settings
			const settings = await c.env.DB.prepare(
				`SELECT max_warnings FROM group_settings WHERE chat_id = ?1`
			).bind(chat.id).first<{ max_warnings: number }>();
			const maxWarnings = settings?.max_warnings || 3;

			// 5. Enforcement: Ban if threshold met, otherwise warn
			if (warnings >= maxWarnings) {
				c.executionCtx.waitUntil(tg.banChatMember(chat.id, from.id));
				c.executionCtx.waitUntil(tg.sendMessage(chat.id, `🚨 <b>Security Alert</b>\nUser <a href="tg://user?id=${from.id}">${from.first_name}</a> has been permanently banned for repeated link spamming.`));
				
				// Dispatch to Queue for long-term audit storage
				c.executionCtx.waitUntil(c.env.QUEUE.send({
					logId: crypto.randomUUID(),
					chatId: chat.id,
					userId: from.id,
					action: 'BANNED_FOR_SPAM'
				}));
			} else {
				c.executionCtx.waitUntil(tg.sendMessage(chat.id, `⚠️ <b>Warning (${warnings}/${maxWarnings})</b>\n<a href="tg://user?id=${from.id}">${from.first_name}</a>, links are not permitted in this group.`));
				
				c.executionCtx.waitUntil(c.env.QUEUE.send({
					logId: crypto.randomUUID(),
					chatId: chat.id,
					userId: from.id,
					action: 'WARNING_ISSUED_FOR_LINK'
				}));
			}
		}
	}

	return c.text('OK');
});

// --- Export Handlers ---
export default {
	fetch: app.fetch,

	// Queue Consumer for background asynchronous operations
	async queue(batch: MessageBatch<AuditLogEvent>, env: Env, ctx: ExecutionContext): Promise<void> {
		const stmt = env.DB.prepare(
			`INSERT INTO audit_logs (log_id, chat_id, user_id, action) VALUES (?1, ?2, ?3, ?4)`
		);

		const batchInsertions = batch.messages.map(msg => 
			stmt.bind(msg.body.logId, msg.body.chatId, msg.body.userId, msg.body.action)
		);

		if (batchInsertions.length > 0) {
			try {
				await env.DB.batch(batchInsertions);
				batch.ackAll();
			} catch (error) {
				console.error("Failed to process audit logs queue batch", error);
				// Messages will be automatically retried based on max_batch_timeout
			}
		}
	}
};
