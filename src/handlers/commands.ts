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
	const text = msg.text || msg.caption || '';
	
	// Normalize commands (e.g. "/ban@GhostSweeperBot" -> "/ban")
	const [rawCommand, ...args] = text.split(' ');
	const command = rawCommand.split('@')[0].toLowerCase();

	if (command === '/start') {
		const welcomeMsg = `👻 <b>GhostSweeper Security Node</b>\n\nI am an advanced, edge-optimized telemetry bot designed to protect your Telegram groups from spam, malicious links, and unauthorized forwards.\n\n🛡️ <b>Core Capabilities:</b>\n• Zero-latency threat neutralization\n• Interactive Admin Dashboard\n• Automated infraction tracking\n\n👨‍💻 <b>Architect & Developer:</b> <a href="https://t.me/CyberCoderBD">CyberCoderBD</a>\n\n<i>To begin, add me to your group and grant me Administrator privileges.</i>`;
		const keyboard = {
			inline_keyboard: [
				[{ text: `➕ Add GhostSweeper to Group`, url: `https://t.me/GhostSweeperBot?startgroup=true` }],
				[{ text: `👨‍💻 Developer Support`, url: `https://t.me/CyberCoderBD` }]
			]
		};
		c.executionCtx.waitUntil(tg.sendMessage(chatId, welcomeMsg, keyboard));
		return;
	}

	if (command === '/help') {
		const helpMsg = `📖 <b>GhostSweeper Command Reference</b>\n\n<b>🛡️ Admin Commands</b>\n⚙️ <code>/settings</code> - Security dashboard\n🔨 <code>/ban</code> - Ban a user (reply)\n✅ <code>/unban</code> - Lift a ban (reply)\n📊 <code>/stats</code> - Telemetry metrics\n\n<b>👤 General Commands</b>\nℹ️ <code>/start</code> - Bot info\n🆘 <code>/help</code> - Manual`;
		c.executionCtx.waitUntil(tg.sendMessage(chatId, helpMsg));
		return;
	}

	if (msg.chat.type === 'private') return;

	const isAdmin = await adminSvc.isAdmin(chatId, msg.from.id);
	if (!isAdmin) return; 

	const getTargetUser = (): number | null => msg.reply_to_message?.from?.id || null;

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
			c.executionCtx.waitUntil(tg.sendMessage(chatId, "⚙️ <b>Group Security Dashboard</b>", keyboard));
			break;
		}
		case '/ban': {
			const targetId = getTargetUser();
			if (!targetId) {
				c.executionCtx.waitUntil(tg.sendMessage(chatId, "⚠️ Reply to a message to execute <code>/ban</code>."));
				return;
			}
			c.executionCtx.waitUntil(tg.banChatMember(chatId, targetId));
			c.executionCtx.waitUntil(c.env.QUEUE.send({ logId: crypto.randomUUID(), chatId, userId: targetId, action: `MANUAL_BAN` }));
			break;
		}
		case '/unban': {
			const targetId = getTargetUser();
			if (!targetId) return;
			c.executionCtx.waitUntil(tg.unbanChatMember(chatId, targetId));
			c.executionCtx.waitUntil(db.clearWarnings(targetId, chatId));
			c.executionCtx.waitUntil(c.env.QUEUE.send({ logId: crypto.randomUUID(), chatId, userId: targetId, action: `MANUAL_UNBAN` }));
			break;
		}
		case '/stats': {
			const stats = await db.getGroupStats(chatId);
			const report = `📊 <b>Group Security Telemetry</b>\n\n🛡️ Total Interventions: ${stats.total_actions}\n👤 Tracked Violators: ${stats.unique_violators}\n⚡ Routing Latency: Edge Optimized`;
			c.executionCtx.waitUntil(tg.sendMessage(chatId, report));
			break;
		}
	}
}
