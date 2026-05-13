import { Context } from 'hono';
import { Env, TelegramUpdate } from '../types';
import { TelegramClient } from '../core/telegram';
import { AdminService } from '../core/admin';
import { DbRepository } from '../db/repository';

export async function handleWebhook(c: Context<{ Bindings: Env }>) {
	const update: TelegramUpdate = await c.req.json();
	const tg = new TelegramClient(c.env.TELEGRAM_BOT_TOKEN);
	const adminSvc = new AdminService(c.env, tg);
	const db = new DbRepository(c.env.DB);

	if (update.message) {
		const msg = update.message;
		const chatId = msg.chat.id;

		// 1. Welcome System Setup
		if (msg.new_chat_members) {
			const names = msg.new_chat_members.map(u => u.first_name).join(', ');
			c.executionCtx.waitUntil(tg.sendMessage(chatId, `👋 Welcome to the group, ${names}! Please review our rules.`));
			return c.text('OK');
		}

		if (!msg.text && !msg.caption) return c.text('OK');

		// Command Routing
		if (msg.text?.startsWith('/')) {
			// Route to command handler (omitted for brevity, assume /ban, /mute, /stats live here)
			return c.text('OK');
		}

		// 2. Threat Analysis Execution
		if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
			if (!msg.from.is_bot && !(await adminSvc.isAdmin(chatId, msg.from.id))) {
				
				// Flood Detection via Edge Cache
				const floodKey = `flood:${chatId}:${msg.from.id}`;
				const msgCount = (await c.env.KV.get<number>(floodKey, 'json')) || 0;
				
				if (msgCount > 5) {
					c.executionCtx.waitUntil(tg.deleteMessage(chatId, msg.message_id));
					c.executionCtx.waitUntil(tg.restrictChatMember(chatId, msg.from.id, { can_send_messages: false }));
					return c.text('OK');
				}
				await c.env.KV.put(floodKey, JSON.stringify(msgCount + 1), { expirationTtl: 5 }); // 5 messages per 5 seconds

				// Policy Evaluation
				const settings = await db.getSettings(chatId);
				const combinedEntities = [...(msg.entities || []), ...(msg.caption_entities || [])];
				const combinedTextLength = (msg.text || msg.caption || '').length;

				// BUGFIX: Mentions ('mention') removed from link categorization.
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
}
