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

	// --- General Commands (Available in Private & Group) ---

	if (command === '/start') {
		const welcomeMsg = `👻 <b>GhostSweeper Security Node</b>\n\nI am an advanced, edge-optimized telemetry bot designed to protect your Telegram groups from spam, malicious links, and unauthorized forwards.\n\n🛡️ <b>Core Capabilities:</b>\n• Zero-latency threat neutralization\n• Interactive Admin Dashboard\n• Automated infraction tracking\n\n👨‍💻 <b>Architect & Developer:</b> <a href="https://t.me/CyberCoderBD">CyberCoderBD</a>\n\n<i>To begin, add me to your group and grant me Administrator privileges.</i>`;
		
		const keyboard = {
			inline_keyboard: [
				// Deep link to instantly prompt the user to add the bot to a group
				[{ text: `➕ Add GhostSweeper to Group`, url: `https://t.me/GhostSweeperBot?startgroup=true` }],
				[{ text: `👨‍💻 Developer Support`, url: `https://t.me/CyberCoderBD` }]
			]
		};

		c.executionCtx.waitUntil(tg.sendMessage(chatId, welcomeMsg, keyboard));
		return;
	}

	if (command === '/help') {
		const helpMsg = `📖 <b>GhostSweeper Command Reference</b>\n\n<b>🛡️ Admin Commands</b> <i>(Requires Group Admin)</i>\n⚙️ <code>/settings</code> - Open the interactive security dashboard\n🔨 <code>/ban</code> - Ban a user (reply to their message)\n✅ <code>/unban</code> - Lift a ban & clear infractions (reply to message)\n📊 <code>/stats</code> - View edge telemetry and intervention metrics\n\n<b>👤 General Commands</b>\nℹ️ <code>/start</code> - Display bot info and developer links\n🆘 <code>/help</code> - Show this command manual\n\n<i>Note: Anti-spam and anti-link policies are automatically enforced on standard users. Administrators are exempt from automated edge filtering.</i>`;
		
		c.executionCtx.waitUntil(tg.sendMessage(chatId, helpMsg));
		return;
	}

	// --- Route Protection: Following commands strictly require a Group context ---
	if (msg.chat.type === 'private') return;

	// Verify Privilege Level
	const isAdmin = await adminSvc.isAdmin(chatId, msg.from.id);
	if (!isAdmin) return; 

	// Helper to extract target user from reply
	const getTargetUser = (): number | null => {
		if (msg.reply_to_message?.from) return msg.reply_to_message.from.id;
		return null; 
	};

	// --- Administrator Commands ---

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
				c.executionCtx.waitUntil(tg.sendMessage(chatId, "⚠️ <b>Syntax Error:</b> Please reply to a specific user's message to execute <code>/ban</code>."));
				return;
			}
			c.executionCtx.waitUntil(tg.banChatMember(chatId, targetId));
			c.executionCtx.waitUntil(tg.sendMessage(chatId, `🔨 User has been permanently removed by <a href="tg://user?id=${msg.from.id}">${msg.from.first_name}</a>.`));
			c.executionCtx.waitUntil(c.env.QUEUE.send({ logId: crypto.randomUUID(), chatId, userId: targetId, action: `MANUAL_BAN` }));
			break;
		}

		case '/unban': {
			const targetId = getTargetUser();
			if (!targetId) {
				c.executionCtx.waitUntil(tg.sendMessage(chatId, "⚠️ <b>Syntax Error:</b> Please reply to a specific user's message to execute <code>/unban</code>."));
				return;
			}
			c.executionCtx.waitUntil(tg.unbanChatMember(chatId, targetId));
			c.executionCtx.waitUntil(db.clearWarnings(targetId, chatId));
			c.executionCtx.waitUntil(tg.sendMessage(chatId, `✅ User ban lifted and all prior infraction records cleared.`));
			c.executionCtx.waitUntil(c.env.QUEUE.send({ logId: crypto.randomUUID(), chatId, userId: targetId, action: `MANUAL_UNBAN` }));
			break;
		}

		case '/stats': {
			const stats = await db.getGroupStats(chatId);
			const report = `📊 <b>Group Security Telemetry</b>\n\n🛡️ <b>Total Interventions:</b> ${stats.total_actions}\n👤 <b>Tracked Violators:</b> ${stats.unique_violators}\n⚡ <b>Routing Latency:</b> Edge Optimized`;
			c.executionCtx.waitUntil(tg.sendMessage(chatId, report));
			break;
		}
	}
}
