import { Context } from 'hono';
import { Env, TelegramMessage } from '../types';
import { TelegramClient } from '../core/telegram';
import { AdminService } from '../core/admin';
import { DbRepository } from '../db/repository';
import { escapeHtml } from '../utils';

export async function handleCommand(
	c: Context<{ Bindings: Env }>, 
	msg: TelegramMessage, 
	tg: TelegramClient, 
	adminSvc: AdminService, 
	db: DbRepository
) {
	const chatId = msg.chat.id;
	const text = msg.text || msg.caption || '';
	
	const [rawCommand, ...args] = text.split(' ');
	const command = rawCommand.split('@')[0].toLowerCase();

	if (command === '/start') {
		const welcomeMsg = `👻 <b>GhostSweeper Security Node</b>\n\nAdvanced, edge-optimized telemetry bot defending groups from spam, malicious links, and unauthorized actions.\n\n🛡️ <b>Capabilities:</b>\n• Zero-latency moderation\n• Interactive Dashboard\n• Telemetry & Infraction tracking\n\n👨‍💻 <b>Developer:</b> <a href="https://t.me/CyberCoderBD">CyberCoderBD</a>`;
		const keyboard = {
			inline_keyboard: [
				[{ text: `➕ Add GhostSweeper`, url: `https://t.me/GhostSweeperBot?startgroup=true` }],
				[{ text: `👨‍💻 Support`, url: `https://t.me/CyberCoderBD` }]
			]
		};
		c.executionCtx.waitUntil(tg.sendMessage(chatId, welcomeMsg, keyboard));
		return;
	}

	if (command === '/help') {
		const helpMsg = `📖 <b>Command Reference</b>\n\n<b>🛡️ Admin Setup</b>\n⚙️ <code>/settings</code> - Security dashboard\n⚙️ <code>/setwarn [num]</code> - Max warnings\n\n<b>🔨 Moderation</b>\n🔨 <code>/ban</code> - Permanently ban (reply)\n🥾 <code>/kick</code> - Remove from group (reply)\n🔇 <code>/mute</code> - Revoke messaging (reply)\n⚠️ <code>/warn</code> - Issue warning (reply)\n✅ <code>/unban</code> - Lift restrictions (reply)\n\n<b>👤 Trust & Info</b>\n🤝 <code>/trust</code> - Whitelist user (reply)\n🛑 <code>/untrust</code> - Remove whitelist (reply)\nℹ️ <code>/info</code> - User metrics (reply)\n📊 <code>/stats</code> - Group telemetry`;
		c.executionCtx.waitUntil(tg.sendMessage(chatId, helpMsg));
		return;
	}

	if (msg.chat.type === 'private') return;

	const isAdmin = await adminSvc.isAdmin(chatId, msg.from.id);
	if (!isAdmin) return; 

	const targetUser = msg.reply_to_message?.from;
	const targetId = targetUser?.id || null;

	switch (command) {
		case '/settings': {
			const settings = await db.getSettings(chatId);
			const keyboard = {
				inline_keyboard: [
					[{ text: `🔗 Anti-Link: ${settings.anti_link ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_link' }],
					[{ text: `🔄 Anti-Forward: ${settings.anti_forward ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_forward' }],
					[{ text: `🛡️ Anti-Spam: ${settings.anti_spam ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_spam' }],
					[{ text: `🌊 Anti-Flood: ${settings.anti_flood ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_flood' }]
				]
			};
			c.executionCtx.waitUntil(tg.sendMessage(chatId, "⚙️ <b>Group Security Dashboard</b>", keyboard));
			break;
		}
		case '/setwarn': {
			const limit = parseInt(args[0]);
			if (isNaN(limit) || limit < 1 || limit > 10) {
				c.executionCtx.waitUntil(tg.sendMessage(chatId, "⚠️ Usage: <code>/setwarn [1-10]</code>"));
				return;
			}
			await db.updateSettingValue(chatId, 'max_warnings', limit);
			c.executionCtx.waitUntil(tg.sendMessage(chatId, `✅ Maximum warnings set to <b>${limit}</b>.`));
			break;
		}
		case '/ban': {
			if (!targetId) return c.executionCtx.waitUntil(tg.sendMessage(chatId, "⚠️ Reply to a message to execute."));
			c.executionCtx.waitUntil(tg.banChatMember(chatId, targetId));
			c.executionCtx.waitUntil(tg.sendMessage(chatId, `🔨 User <b>${escapeHtml(targetUser!.first_name)}</b> banned.`));
			c.executionCtx.waitUntil(c.env.QUEUE.send({ logId: crypto.randomUUID(), chatId, userId: targetId, action: `MANUAL_BAN` }));
			break;
		}
		case '/kick': {
			if (!targetId) return;
			c.executionCtx.waitUntil(tg.banChatMember(chatId, targetId));
			c.executionCtx.waitUntil(tg.unbanChatMember(chatId, targetId)); // Ban then unban to kick
			c.executionCtx.waitUntil(tg.sendMessage(chatId, `🥾 User <b>${escapeHtml(targetUser!.first_name)}</b> kicked.`));
			c.executionCtx.waitUntil(c.env.QUEUE.send({ logId: crypto.randomUUID(), chatId, userId: targetId, action: `MANUAL_KICK` }));
			break;
		}
		case '/mute': {
			if (!targetId) return;
			c.executionCtx.waitUntil(tg.restrictChatMember(chatId, targetId, { can_send_messages: false }));
			c.executionCtx.waitUntil(tg.sendMessage(chatId, `🔇 User <b>${escapeHtml(targetUser!.first_name)}</b> muted.`));
			c.executionCtx.waitUntil(c.env.QUEUE.send({ logId: crypto.randomUUID(), chatId, userId: targetId, action: `MANUAL_MUTE` }));
			break;
		}
		case '/warn': {
			if (!targetId) return;
			const settings = await db.getSettings(chatId);
			const warnings = await db.recordInfraction(targetId, chatId);
			
			if (warnings >= settings.max_warnings) {
				c.executionCtx.waitUntil(tg.banChatMember(chatId, targetId));
				c.executionCtx.waitUntil(tg.sendMessage(chatId, `🔨 User <b>${escapeHtml(targetUser!.first_name)}</b> banned for reaching <b>${settings.max_warnings}</b> warnings.`));
			} else {
				c.executionCtx.waitUntil(tg.sendMessage(chatId, `⚠️ User <b>${escapeHtml(targetUser!.first_name)}</b> warned (${warnings}/${settings.max_warnings}).`));
			}
			break;
		}
		case '/unban': {
			if (!targetId) return;
			c.executionCtx.waitUntil(tg.unbanChatMember(chatId, targetId));
			c.executionCtx.waitUntil(db.clearWarnings(targetId, chatId));
			c.executionCtx.waitUntil(tg.sendMessage(chatId, `✅ Restrictions lifted for <b>${escapeHtml(targetUser!.first_name)}</b>.`));
			c.executionCtx.waitUntil(c.env.QUEUE.send({ logId: crypto.randomUUID(), chatId, userId: targetId, action: `MANUAL_UNBAN` }));
			break;
		}
		case '/trust': {
			if (!targetId) return;
			c.executionCtx.waitUntil(db.setTrusted(targetId, chatId, msg.from.id, true));
			c.executionCtx.waitUntil(tg.sendMessage(chatId, `🤝 User <b>${escapeHtml(targetUser!.first_name)}</b> is now trusted (exempt from rules).`));
			break;
		}
		case '/untrust': {
			if (!targetId) return;
			c.executionCtx.waitUntil(db.setTrusted(targetId, chatId, msg.from.id, false));
			c.executionCtx.waitUntil(tg.sendMessage(chatId, `🛑 Trust removed for <b>${escapeHtml(targetUser!.first_name)}</b>.`));
			break;
		}
		case '/info': {
			if (!targetId) return;
			const isTrust = await db.isTrusted(targetId, chatId);
			const isAd = await adminSvc.isAdmin(chatId, targetId);
			const warns = await db.getWarnings(targetId, chatId);
			
			let infoMsg = `ℹ️ <b>User Info:</b> ${escapeHtml(targetUser!.first_name)}\n`;
			infoMsg += `• ID: <code>${targetId}</code>\n`;
			infoMsg += `• Admin: ${isAd ? 'Yes' : 'No'}\n`;
			infoMsg += `• Trusted: ${isTrust ? 'Yes' : 'No'}\n`;
			infoMsg += `• Warnings: ${warns}`;
			c.executionCtx.waitUntil(tg.sendMessage(chatId, infoMsg));
			break;
		}
		case '/stats': {
			const stats = await db.getGroupStats(chatId);
			const report = `📊 <b>Group Security Telemetry</b>\n\n🛡️ Interventions: ${stats.total_actions}\n👤 Tracked Violators: ${stats.unique_violators}\n⚡ Latency: Edge Optimized`;
			c.executionCtx.waitUntil(tg.sendMessage(chatId, report));
			break;
		}
	}
}
