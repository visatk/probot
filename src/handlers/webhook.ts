import { Context } from 'hono';
import { Env, TelegramUpdate } from '../types';
import { TelegramClient } from '../core/telegram';
import { AdminService } from '../core/admin';
import { DbRepository } from '../db/repository';
import { handleCommand } from './commands';
import { handleCallbackQuery } from './callback';
import { escapeHtml, isAdvancedSpam, containsHiddenLink } from '../utils';

// Isolate-scoped memory cache for extremely fast L1 flood detection
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
		
		// Handle bot being kicked/added
		if (update.my_chat_member) {
			const status = update.my_chat_member.new_chat_member.status;
			if (status === 'kicked' || status === 'left') {
				c.executionCtx.waitUntil(db.removeGroup(update.my_chat_member.chat.id));
			}
			return c.text('OK');
		}

		if (update.message) {
			const msg = update.message;
			const chatId = msg.chat.id;

			if (msg.new_chat_members) {
				const names = msg.new_chat_members.map(u => escapeHtml(u.first_name)).join(', ');
				c.executionCtx.waitUntil(tg.sendMessage(chatId, `👋 Welcome, <b>${names}</b>! Please review our rules.`));
				return c.text('OK');
			}
			
			if (msg.left_chat_member) {
				// Optional: c.executionCtx.waitUntil(tg.deleteMessage(chatId, msg.message_id));
				return c.text('OK');
			}

			if (!msg.text && !msg.caption) return c.text('OK');

			if (msg.text?.startsWith('/') || msg.caption?.startsWith('/')) {
				await handleCommand(c, msg, tg, adminSvc, db);
				return c.text('OK');
			}

			if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
				if (!msg.from.is_bot && !(await adminSvc.isAdmin(chatId, msg.from.id)) && !(await db.isTrusted(msg.from.id, chatId))) {
					
					const settings = await db.getSettings(chatId);

					// L1/L2 Flood Detection Strategy
					if (settings.anti_flood) {
						const floodKey = `${chatId}:${msg.from.id}`;
						const now = Date.now();
						const userFlood = isolateFloodCache.get(floodKey) || { count: 0, timestamp: now };
						
						if (now - userFlood.timestamp > 5000) {
							userFlood.count = 0;
							userFlood.timestamp = now;
						}
						userFlood.count += 1;
						isolateFloodCache.set(floodKey, userFlood);
						
						let isFlooding = userFlood.count > 5;
						
						// Fallback to KV L2 if isolate memory gets hot, avoiding excessive writes unless threshold hit
						if (!isFlooding && userFlood.count > 3) {
							const kvFloodKey = `flood:${floodKey}`;
							const kvCount = await c.env.KV.get(kvFloodKey);
							if (kvCount && parseInt(kvCount) > 5) isFlooding = true;
							else c.executionCtx.waitUntil(c.env.KV.put(kvFloodKey, String(userFlood.count), { expirationTtl: 60 }));
						}

						if (isFlooding) {
							c.executionCtx.waitUntil(tg.deleteMessage(chatId, msg.message_id));
							c.executionCtx.waitUntil(tg.restrictChatMember(chatId, msg.from.id, { can_send_messages: false }));
							c.executionCtx.waitUntil(tg.sendMessage(chatId, `🌊 User <b>${escapeHtml(msg.from.first_name)}</b> muted for flooding.`));
							return c.text('OK');
						}
					}

					// Core Policy Evaluation
					const combinedText = msg.text || msg.caption || '';
					const combinedEntities = [...(msg.entities || []), ...(msg.caption_entities || [])];

					const hasLinkEntity = combinedEntities.some(e => e.type === 'url' || e.type === 'text_link');
					const hasHiddenLink = containsHiddenLink(combinedText);
					const hasLink = hasLinkEntity || hasHiddenLink;
					
					const isForward = !!msg.forward_origin;
					
					const isBasicSpam = combinedText.length > 800;
					const isAdvancedPatternSpam = isAdvancedSpam(combinedText);
					const isSpam = (isBasicSpam || isAdvancedPatternSpam) && settings.anti_spam;

					let violationType: string | null = null;
					if (hasLink && settings.anti_link) violationType = 'LINK';
					else if (isForward && settings.anti_forward) violationType = 'UNAUTHORIZED_FORWARD';
					else if (isSpam) violationType = 'TEXT_SPAM';

					if (violationType) {
						c.executionCtx.waitUntil(tg.deleteMessage(chatId, msg.message_id));
						const warnings = await db.recordInfraction(msg.from.id, chatId);
						
						const meta = { violation: violationType, textLength: combinedText.length };
						
						if (warnings >= settings.max_warnings) {
							c.executionCtx.waitUntil(tg.banChatMember(chatId, msg.from.id));
							c.executionCtx.waitUntil(tg.sendMessage(chatId, `🔨 User <b>${escapeHtml(msg.from.first_name)}</b> banned for reaching <b>${settings.max_warnings}</b> warnings.`));
							c.executionCtx.waitUntil(c.env.QUEUE.send({ logId: crypto.randomUUID(), chatId, userId: msg.from.id, action: `BANNED_${violationType}`, metadata: meta }));
						} else {
							c.executionCtx.waitUntil(tg.sendMessage(chatId, `⚠️ User <b>${escapeHtml(msg.from.first_name)}</b> warned for violating <b>${violationType.replace('_', ' ')}</b> policies (${warnings}/${settings.max_warnings}).`));
							c.executionCtx.waitUntil(c.env.QUEUE.send({ logId: crypto.randomUUID(), chatId, userId: msg.from.id, action: `WARNING_${violationType}`, metadata: meta }));
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
