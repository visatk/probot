import { Context } from 'hono';
import { Env, TelegramMessage } from '../types';
import { TelegramClient } from '../core/telegram';
import { AdminService } from '../core/admin';
import { DbRepository } from '../db/repository';

export async function handleCommand(
	c: Context<{ Bindings: Env }>, 
	msg: TelegramMessage, 
	tg: TelegramClient, 
	adminSvc: AdminService, 
	db: DbRepository
) {
	const chatId = msg.chat.id;
	const text = msg.text || '';
	const [command, ...args] = text.split(' ');

	if (command === '/start') {
		const welcomeMsg = `🤖 <b>GhostSweeper Edge Security Node</b>\n\nAdvanced threat neutralization and telemetry bot.\n\nTo begin, add me to your group and grant Administrator privileges. Use /settings in your group to configure policies.`;
		c.executionCtx.waitUntil(tg.sendMessage(chatId, welcomeMsg));
		return;
	}

	if (msg.chat.type === 'private') return;

	// Verify Privilege Level
	const isAdmin = await adminSvc.isAdmin(chatId, msg.from.id);
	if (!isAdmin) return; 

	// Helper to extract target user from reply or text
	const getTargetUser = (): number | null => {
		if (msg.reply_to_message?.from) return msg.reply_to_message.from.id;
		return null; // Note: Expanding this to parse mentions from 'args' would require resolving usernames via MTProto, relying on replies is more resilient for bots.
	};

	switch (command) {
		case '/settings': {
			const settings = await db.getSettings(chatId);
			const keyboard = {
				inline_keyboard: [
					[{ text: `🔗 Anti-Link: ${settings.anti_link ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_link' }],
					[{ text: `🔄 Anti-Forward: ${settings.anti_forward ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_forward' }],
					[{ text: `🛡️ Anti-Spam: ${settings.anti_spam ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_spam' }]
				]
			};
			c.executionCtx.waitUntil(tg.sendMessage(chatId, "⚙️ <b>Group Security Dashboard</b>\nSelect parameters to toggle:", keyboard));
			break;
		}

		case '/ban': {
			const targetId = getTargetUser();
			if (!targetId) {
				c.executionCtx.waitUntil(tg.sendMessage(chatId, "⚠️ <b>Syntax Error:</b> Reply to a message to /ban the user."));
				return;
			}
			c.executionCtx.waitUntil(tg.banChatMember(chatId, targetId));
			c.executionCtx.waitUntil(tg.sendMessage(chatId, `🔨 User has been permanently removed by <a href="tg://user?id=${msg.from.id}">${msg.from.first_name}</a>.`));
			c.executionCtx.waitUntil(c.env.QUEUE.send({ logId: crypto.randomUUID(), chatId, userId: targetId, action: `MANUAL_BAN` }));
			break;
		}

		case '/unban': {
			const targetId = getTargetUser();
			if (!targetId) return;
			c.executionCtx.waitUntil(tg.unbanChatMember(chatId, targetId));
			c.executionCtx.waitUntil(db.clearWarnings(targetId, chatId));
			c.executionCtx.waitUntil(tg.sendMessage(chatId, `✅ User ban lifted and infraction records cleared.`));
			c.executionCtx.waitUntil(c.env.QUEUE.send({ logId: crypto.randomUUID(), chatId, userId: targetId, action: `MANUAL_UNBAN` }));
			break;
		}

		case '/stats': {
			const stats = await db.getGroupStats(chatId);
			const report = `📊 <b>Group Security Telemetry</b>\n\n🛡️ <b>Total Interventions:</b> ${stats.total_actions}\n👤 <b>Tracked Violators:</b> ${stats.unique_violators}\n⚡ <b>Latency:</b> Edge Optimized`;
			c.executionCtx.waitUntil(tg.sendMessage(chatId, report));
			break;
		}
	}
}
