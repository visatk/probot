import { Context } from 'hono';
import { Env, TelegramUpdate } from '../types';
import { TelegramClient } from '../core/telegram';
import { AdminService } from '../core/admin';
import { DbRepository } from '../db/repository';

export async function handleCallbackQuery(
	c: Context<{ Bindings: Env }>, 
	update: TelegramUpdate, 
	tg: TelegramClient, 
	adminSvc: AdminService, 
	db: DbRepository
) {
	const cb = update.callback_query;
	if (!cb || !cb.message) return;

	const chatId = cb.message.chat.id;

	// Interactive privilege check
	const isAdmin = await adminSvc.isAdmin(chatId, cb.from.id);
	if (!isAdmin) {
		c.executionCtx.waitUntil(tg.answerCallbackQuery(cb.id, "Access Denied: Administrators only.", true));
		return;
	}

	// State Mutation Execution
	if (cb.data?.startsWith('toggle_')) {
		const setting = cb.data.replace('toggle_', '');
		
		try {
			await db.toggleSetting(chatId, setting);
		} catch (e) {
			console.error("Invalid toggle operation:", e);
			c.executionCtx.waitUntil(tg.answerCallbackQuery(cb.id, "Error updating settings.", true));
			return;
		}
		
		// Fetch updated state & Render Interface
		const settings = await db.getSettings(chatId);
		const keyboard = {
			inline_keyboard: [
				[{ text: `🔗 Anti-Link: ${settings.anti_link ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_link' }],
				[{ text: `🔄 Anti-Forward: ${settings.anti_forward ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_forward' }],
				[{ text: `🛡️ Anti-Spam: ${settings.anti_spam ? '🟢 ON' : '🔴 OFF'}`, callback_data: 'toggle_anti_spam' }]
			]
		};

		c.executionCtx.waitUntil(tg.editMessageText(chatId, cb.message.message_id, "⚙️ <b>Group Security Dashboard</b>\nSelect parameters to toggle:", keyboard));
	}

	c.executionCtx.waitUntil(tg.answerCallbackQuery(cb.id));
}
