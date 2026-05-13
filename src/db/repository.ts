import { Env, GroupSettings } from '../types';

export class DbRepository {
	constructor(private db: D1Database) {}

	async getSettings(chatId: number): Promise<GroupSettings> {
		const settings = await this.db.prepare(`SELECT * FROM group_settings WHERE chat_id = ?1`).bind(chatId).first<GroupSettings>();
		return settings || { chat_id: chatId, anti_link: 1, anti_forward: 0, anti_spam: 1, max_warnings: 3 };
	}

	async toggleSetting(chatId: number, setting: string): Promise<void> {
		// Strict allowlist validation to prevent SQL injection or bad column references
		const allowedSettings = ['anti_link', 'anti_forward', 'anti_spam'];
		if (!allowedSettings.includes(setting)) throw new Error("Invalid setting column");

		await this.db.prepare(`
			INSERT INTO group_settings (chat_id, ${setting}) VALUES (?1, 0)
			ON CONFLICT(chat_id) DO UPDATE SET ${setting} = NOT ${setting}
		`).bind(chatId).run();
	}

	async recordInfraction(userId: number, chatId: number): Promise<number> {
		const result = await this.db.prepare(`
			INSERT INTO user_infractions (user_id, chat_id, warnings) VALUES (?1, ?2, 1) 
			ON CONFLICT(user_id, chat_id) DO UPDATE SET warnings = warnings + 1, last_violation = CURRENT_TIMESTAMP
			RETURNING warnings;
		`).bind(userId, chatId).first<{ warnings: number }>();
		return result?.warnings || 1;
	}

	async clearWarnings(userId: number, chatId: number): Promise<void> {
		await this.db.prepare(`UPDATE user_infractions SET warnings = 0 WHERE user_id = ?1 AND chat_id = ?2`).bind(userId, chatId).run();
	}
}
