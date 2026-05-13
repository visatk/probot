import { Context } from 'hono';
import { Env, TelegramUpdate } from '../types';
import { TelegramClient } from '../core/telegram';
import { AdminService } from '../core/admin';
import { DbRepository } from '../db/repository';
import { handleCommand } from './commands';
import { handleCallbackQuery } from './callback';

// Isolate-scoped memory cache for sub-minute flood detection.
const isolateFloodCache = new Map<string, { count: number; timestamp: number }>();

export async function handleWebhook(c: Context<{ Bindings: Env }>) {
	try {
		const update: TelegramUpdate = await c.req.json();
		const tg = new TelegramClient(c.env.TELEGRAM_BOT_TOKEN);
		const adminSvc = new AdminService(c.env, tg);
		const db = new DbRepository(c.env.DB);

		if (update.callback_query) {
			await handleCallbackQuery(c, update, tg, adminSvc, db);
			return c.text('OK');
		}

		if (update.message) {
			const msg = update.message;
			const chatId = msg.chat.id;

			if (msg.new_chat_members) {
				const names = msg.new_chat_members.map(u => u.first_name).join(', ');
				c.executionCtx.waitUntil(tg.sendMessage(chatId, `👋 Welcome, ${names}! Please review our rules.`));
				return c.text('OK');
			}

			if (!msg.text && !msg.caption) return c.text('OK');

			if (msg.text?.startsWith('/') || msg.caption?.startsWith('/')) {
				await handleCommand(c, msg, tg, adminSvc, db);
				return c.text('OK');
			}

			if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
				if (!msg.from.is_bot && !(await adminSvc.isAdmin(chatId, msg.from.id))) {
					
					// Edge-local Flood Detection (Bypasses KV 60s constraint)
					const floodKey = `${chatId}:${msg.from.id}`;
					const now = Date.now();
					const userFlood = isolateFloodCache.get(floodKey) || { count: 0, timestamp: now };
					
					// Reset counter if more than 5 seconds passed
					if (now - userFlood.timestamp > 5000) {
						userFlood.count = 0;
						userFlood.timestamp = now;
					}
					
					userFlood.count += 1;
					isolateFloodCache.set(floodKey, userFlood);
					
					if (userFlood.count > 5) {
						c.executionCtx.waitUntil(tg.deleteMessage(chatId, msg.message_id));
						c.executionCtx.waitUntil(tg.restrictChatMember(chatId, msg.from.id, { can_send_messages: false }));
						return c.text('OK');
					}

					// Core Policy Evaluation
					const settings = await db.getSettings(chatId);
					const combinedEntities = [...(msg.entities || []), ...(msg.caption_entities || [])];
					const combinedTextLength = (msg.text || msg.caption || '').length;

					const hasLink = combinedEntities.some(e => e.type === 'url' || e.type === 'text_link');
					const isForward = !!msg.forward_origin;
					const isSpam = combinedTextLength > 800 && settings.anti_spam;

					let violationType: string | null = null;
					if (hasLink && settings.anti_link) violationType = 'LINK';
					else if (isForward && settings.anti_forward) violationType = 'UNAUTHORIZED_FORWARD';
					else if (isSpam) violationType = 'TEXT_SPAM';

					if (violationType) {
						c.executionCtx.waitUntil(tg.deleteMessage(chatId, msg.message_id));
						const warnings = await db.recordInfraction(msg.from.id, chatId);
						
						if (warnings >= settings.max_warnings) {
							c.executionCtx.waitUntil(tg.banChatMember(chatId, msg.from.id));
							c.executionCtx.waitUntil(c.env.QUEUE.send({ logId: crypto.randomUUID(), chatId, userId: msg.from.id, action: `BANNED_${violationType}` }));
						} else {
							c.executionCtx.waitUntil(c.env.QUEUE.send({ logId: crypto.randomUUID(), chatId, userId: msg.from.id, action: `WARNING_${violationType}` }));
						}
					}
				}
			}
		}
		return c.text('OK');

	} catch (error) {
		console.error("Pipeline Failure:", error);
		return c.text('OK'); // Prevent infinite Telegram retry loops
	}
}
