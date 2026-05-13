import { Hono } from 'hono';

// --- Bindings & Types ---
export interface Env {
	DB: D1Database;
	KV: KVNamespace;
	QUEUE: Queue;
	TELEGRAM_BOT_TOKEN: string;
	TELEGRAM_SECRET_TOKEN: string;
}

interface TelegramUser {
	id: number;
	is_bot: boolean;
	first_name: string;
	username?: string;
}

interface TelegramMessage {
	message_id: number;
	from: TelegramUser;
	chat: { id: number; type: string; title?: string };
	date: number;
	text?: string;
	caption?: string;
	forward_origin?: any;
	entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
	caption_entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
}

interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	callback_query?: {
		id: string;
		from: TelegramUser;
		message?: TelegramMessage;
		data?: string;
	};
}

// --- Resilient Telegram Transport Layer ---
class TelegramClient {
	constructor(private token: string) {}

	async callApi(method: string, payload: any): Promise<Response | null> {
		try {
			const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			if (!response.ok) {
				const errorData = await response.text();
				console.error(`Telegram API Error (${method}):`, errorData);
			}
			return response;
		} catch (error) {
			console.error(`Fetch Error (${method}):`, error);
			return null;
		}
	}

	async deleteMessage(chatId: number, messageId: number) {
		return this.callApi('deleteMessage', { chat_id: chatId, message_id: messageId });
	}

	async sendMessage(chatId: number, text: string, replyMarkup?: any) {
		return this.callApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: replyMarkup });
	}

	async editMessageText(chatId: number, messageId: number, text: string, replyMarkup?: any) {
		return this.callApi('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: replyMarkup });
	}

	async banChatMember(chatId: number, userId: number) {
		return this.callApi('banChatMember', { chat_id: chatId, user_id: userId, revoke_messages: true });
	}

	async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert: boolean = false) {
		return this.callApi('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: showAlert });
	}

	async getChatAdministrators(chatId: number): Promise<number[]> {
		const res = await this.callApi('getChatAdministrators', { chat_id: chatId });
		if (!res || !res.ok) return [];
		const data = await res.json() as any;
		return data.result.map((member: any) => member.user.id);
	}
}

// --- Application Core ---
const app = new Hono<{ Bindings: Env }>();

// Security Middleware: Cryptographic Webhook Validation
app.use('/webhook', async (c, next) => {
	const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token');
	if (secretToken !== c.env.TELEGRAM_SECRET_TOKEN) {
		console.warn("Unauthorized webhook invocation attempt.");
		return c.text('Unauthorized', 401);
	}
	await next();
});

app.post('/webhook', async (c) => {
	let update: TelegramUpdate;
	try {
		update = await c.req.json();
	} catch (e) {
		return c.text('Malformed JSON', 400);
	}

	const tg = new TelegramClient(c.env.TELEGRAM_BOT_TOKEN);

	// --- 1. Interactive UI/UX: Settings Dashboard (Callback Queries) ---
	if (update.callback_query) {
		const cb = update.callback_query;
		const chatId = cb.message?.chat.id;
		if (!chatId) return c.text('OK');

		// Privilege Check via Edge Cache (5-minute TTL to prevent stale admin lists)
		const cacheKey = `admins:${chatId}`;
		let admins: number[] = await c.env.KV.get(cacheKey, 'json') || [];
		
		if (admins.length === 0) {
			admins = await tg.getChatAdministrators(chatId);
			if (admins.length > 0) {
				await c.env.KV.put(cacheKey, JSON.stringify(admins), { expirationTtl: 300 });
			}
		}

		if (!admins.includes(cb.from.id)) {
			c.executionCtx.waitUntil(tg.answerCallbackQuery(cb.id, "Access Denied: Administrators only.", true));
			return c.text('OK');
		}

		// State Mutation
		if (cb.data?.startsWith('toggle_')) {
			const setting = cb.data.replace('toggle_', '');
			if (['anti_link', 'anti_forward', 'anti_spam'].includes(setting)) {
				await c.env.DB.prepare(`
					INSERT INTO group_settings (chat_id, ${setting}) VALUES (?1, 0)
					ON CONFLICT(chat_id) DO UPDATE SET ${setting} = NOT ${setting}
				`).bind(chatId).run();
			}
		}

		// Fetch updated state & Render Interface
		const settings = await c.env.DB.prepare(`SELECT * FROM group_settings WHERE chat_id = ?1`).bind(chatId).first() || 
			{ anti_link: 1, anti_forward: 0, anti_spam: 1 };

		const keyboard = {
			inline_keyboard: [
				[{ text: `🔗 Anti-Link: ${settings.anti_link ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_link' }],
				[{ text: `🔄 Anti-Forward: ${settings.anti_forward ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_forward' }],
				[{ text: `🛡️ Anti-Spam: ${settings.anti_spam ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_spam' }]
			]
		};

		c.executionCtx.waitUntil(tg.editMessageText(chatId, cb.message!.message_id, "⚙️ <b>Group Security Dashboard</b>\nSelect parameters to toggle:", keyboard));
		c.executionCtx.waitUntil(tg.answerCallbackQuery(cb.id));
		return c.text('OK');
	}

	// --- 2. Message Processing Pipeline ---
	if (!update.message) return c.text('OK');
	const { message } = update;
	const { chat, from } = message;

	// Global Onboarding Command (Works in Private and Group chats)
	if (message.text?.startsWith('/start')) {
		const welcomeMsg = `🤖 <b>GhostSweeper Group Protection Bot</b>\n\nI am an advanced security and telemetry bot deployed on the edge, designed to protect groups from malicious links, spam, and unauthorized forwards.\n\n🛡️ <b>Core Features:</b>\n- Zero-Latency Threat Neutralization\n- Automated Infraction Tracking\n- Real-time Interactive Admin Dashboard\n\n👨‍💻 <b>Developer & Architect:</b> <a href="https://t.me/drkingbd">Dr. King</a>\n\n<i>To begin, add me to your group and grant Administrator privileges. Use the /settings command in your group to configure policies.</i>`;
		
		const keyboard = {
			inline_keyboard: [
				[{ text: `👨‍💻 Contact Developer`, url: 'https://t.me/drkingbd' }],
				// Provide a generic deep link for users to add the bot to their groups easily.
				[{ text: `➕ Add to Group`, url: `https://t.me/botfather` }] // Change 'botfather' to your actual bot's username once created
			]
		};

		c.executionCtx.waitUntil(tg.sendMessage(chat.id, welcomeMsg, keyboard));
		return c.text('OK');
	}

	// Ensure Threat Analysis only runs in Groups/Supergroups
	if (chat.type !== 'group' && chat.type !== 'supergroup') return c.text('OK');

	// Routing: Admin Configuration Command
	if (message.text?.startsWith('/settings')) {
		const cacheKey = `admins:${chat.id}`;
		let admins: number[] = await c.env.KV.get(cacheKey, 'json') || [];
		if (!admins.length) admins = await tg.getChatAdministrators(chat.id);
		
		if (admins.includes(from.id)) {
			const settings = await c.env.DB.prepare(`SELECT * FROM group_settings WHERE chat_id = ?1`).bind(chat.id).first() || 
				{ anti_link: 1, anti_forward: 0, anti_spam: 1 };
			
			const keyboard = {
				inline_keyboard: [
					[{ text: `🔗 Anti-Link: ${settings.anti_link ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_link' }],
					[{ text: `🔄 Anti-Forward: ${settings.anti_forward ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_forward' }],
					[{ text: `🛡️ Anti-Spam: ${settings.anti_spam ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_spam' }]
				]
			};
			c.executionCtx.waitUntil(tg.sendMessage(chat.id, "⚙️ <b>Group Security Dashboard</b>\nSelect parameters to toggle:", keyboard));
		}
		return c.text('OK'); 
	}

	// Threat Analysis Execution
	if (!from.is_bot) {
		const cacheKey = `admins:${chat.id}`;
		let admins: number[] = await c.env.KV.get(cacheKey, 'json') || [];
		if (!admins.length) admins = await tg.getChatAdministrators(chat.id);

		// Admins bypass all filters
		if (!admins.includes(from.id)) {
			const settings = await c.env.DB.prepare(`SELECT * FROM group_settings WHERE chat_id = ?1`).bind(chat.id).first() || 
				{ anti_link: 1, anti_forward: 0, anti_spam: 1, max_warnings: 3 };

			let violationType: string | null = null;

			// Unified entity & content checking (covers both text AND media captions)
			const combinedEntities = [...(message.entities || []), ...(message.caption_entities || [])];
			const combinedTextLength = (message.text || message.caption || '').length;

			const hasLink = combinedEntities.some(e => e.type === 'url' || e.type === 'text_link' || e.type === 'mention');
			const isForward = !!message.forward_origin;
			const isSpam = combinedTextLength > 800 && settings.anti_spam;

			if (hasLink && settings.anti_link) violationType = 'LINK_OR_MENTION';
			else if (isForward && settings.anti_forward) violationType = 'UNAUTHORIZED_FORWARD';
			else if (isSpam) violationType = 'TEXT_SPAM';

			if (violationType) {
				// Immediate neutralization
				c.executionCtx.waitUntil(tg.deleteMessage(chat.id, message.message_id));

				// State mutation: Record infraction
				const result = await c.env.DB.prepare(`
					INSERT INTO user_infractions (user_id, chat_id, warnings) VALUES (?1, ?2, 1) 
					ON CONFLICT(user_id, chat_id) DO UPDATE SET warnings = warnings + 1, last_violation = CURRENT_TIMESTAMP
					RETURNING warnings;
				`).bind(from.id, chat.id).first<{ warnings: number }>();

				const warnings = result?.warnings || 1;
				const maxWarnings = Number(settings.max_warnings) || 3;

				if (warnings >= maxWarnings) {
					c.executionCtx.waitUntil(tg.banChatMember(chat.id, from.id));
					c.executionCtx.waitUntil(tg.sendMessage(chat.id, `🚨 <b>Enforcement Protocol Executed</b>\nUser <a href="tg://user?id=${from.id}">${from.first_name}</a> has been permanently removed.\nReason: Repeated policy violations (${violationType}).`));
					c.executionCtx.waitUntil(c.env.QUEUE.send({ logId: crypto.randomUUID(), chatId: chat.id, userId: from.id, action: `BANNED_${violationType}` }));
				} else {
					c.executionCtx.waitUntil(tg.sendMessage(chat.id, `⚠️ <b>Automated Warning (${warnings}/${maxWarnings})</b>\n<a href="tg://user?id=${from.id}">${from.first_name}</a>, your message violated group policy (${violationType}). Further infractions will result in removal.`));
					c.executionCtx.waitUntil(c.env.QUEUE.send({ logId: crypto.randomUUID(), chatId: chat.id, userId: from.id, action: `WARNING_${violationType}` }));
				}
			}
		}
	}

	return c.text('OK');
});

export default {
	fetch: app.fetch,

	// --- 3. Asynchronous Observability (Queue Consumer) ---
	async queue(batch: MessageBatch<any>, env: Env, ctx: ExecutionContext): Promise<void> {
		if (batch.messages.length === 0) return;

		const stmt = env.DB.prepare(`INSERT INTO audit_logs (log_id, chat_id, user_id, action) VALUES (?1, ?2, ?3, ?4)`);
		const batchInsertions = batch.messages.map(msg => 
			stmt.bind(msg.body.logId, msg.body.chatId, msg.body.userId, msg.body.action)
		);

		try {
			await env.DB.batch(batchInsertions);
			batch.ackAll();
		} catch (error) {
			console.error("D1 Audit Log Batch Insertion Error:", error);
			// Implicit retry: by NOT calling ackAll() on failure, the queue will retry 
			// the batch based on the queue's max_retries configuration.
		}
	}
};
