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

	// Global Onboarding Command (Works in Private and Group chats)
	if (text.startsWith('/start')) {
		const welcomeMsg = `🤖 <b>GhostSweeper Bot</b>\n\nAdvanced security & telemetry bot deployed on the edge.\n\nTo begin, add me to your group and grant Administrator privileges. Use /settings in your group to configure policies.`;
		c.executionCtx.waitUntil(tg.sendMessage(chatId, welcomeMsg));
		return;
	}

	// Route protection: ensure following commands only run in groups
	if (msg.chat.type === 'private') return;

	// Privilege verification
	const isAdmin = await adminSvc.isAdmin(chatId, msg.from.id);
	if (!isAdmin) return; // Silently ignore unauthorized command attempts

	// Admin Configuration Routing
	if (text.startsWith('/settings')) {
		const settings = await db.getSettings(chatId);
		
		const keyboard = {
			inline_keyboard: [
				[{ text: `🔗 Anti-Link: ${settings.anti_link ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_link' }],
				[{ text: `🔄 Anti-Forward: ${settings.anti_forward ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_forward' }],
				[{ text: `🛡️ Anti-Spam: ${settings.anti_spam ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_spam' }]
			]
		};
		c.executionCtx.waitUntil(tg.sendMessage(chatId, "⚙️ <b>Group Security Dashboard</b>\nSelect parameters to toggle:", keyboard));
	}
}
