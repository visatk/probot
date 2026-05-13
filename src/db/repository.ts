import { Env, GroupSettings } from '../types';

export class DbRepository {
	constructor(private db: D1Database) {}

	async getSettings(chatId: number): Promise<GroupSettings> {
		const settings = await this.db.prepare(`SELECT * FROM group_settings WHERE chat_id = ?1`).bind(chatId).first<GroupSettings>();
		return settings || { 
			chat_id: chatId, anti_link: 1, anti_forward: 0, anti_spam: 1, anti_flood: 1, max_warnings: 3, log_channel_id: null 
		};
	}

	async toggleSetting(chatId: number, setting: string): Promise<void> {
		const allowedSettings = ['anti_link', 'anti_forward', 'anti_spam', 'anti_flood'];
		if (!allowedSettings.includes(setting)) throw new Error("Invalid setting column");

		await this.db.prepare(`
			INSERT INTO group_settings (chat_id, ${setting}) VALUES (?1, 0)
			ON CONFLICT(chat_id) DO UPDATE SET ${setting} = NOT ${setting}
		`).bind(chatId).run();
	}

	async updateSettingValue(chatId: number, setting: string, value: number): Promise<void> {
		const allowedSettings = ['max_warnings', 'log_channel_id'];
		if (!allowedSettings.includes(setting)) return;

		await this.db.prepare(`
			INSERT INTO group_settings (chat_id, ${setting}) VALUES (?1, ?2)
			ON CONFLICT(chat_id) DO UPDATE SET ${setting} = ?2
		`).bind(chatId, value).run();
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
	
	async getWarnings(userId: number, chatId: number): Promise<number> {
		const res = await this.db.prepare(`SELECT warnings FROM user_infractions WHERE user_id = ?1 AND chat_id = ?2`).bind(userId, chatId).first<{ warnings: number }>();
		return res?.warnings || 0;
	}

	async isTrusted(userId: number, chatId: number): Promise<boolean> {
		const res = await this.db.prepare(`SELECT 1 FROM trusted_users WHERE user_id = ?1 AND chat_id = ?2`).bind(userId, chatId).first();
		return !!res;
	}

	async setTrusted(userId: number, chatId: number, adminId: number, trust: boolean): Promise<void> {
		if (trust) {
			await this.db.prepare(`INSERT INTO trusted_users (user_id, chat_id, added_by) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING`).bind(userId, chatId, adminId).run();
		} else {
			await this.db.prepare(`DELETE FROM trusted_users WHERE user_id = ?1 AND chat_id = ?2`).bind(userId, chatId).run();
		}
	}

	async getGroupStats(chatId: number): Promise<{ total_actions: number, unique_violators: number }> {
		const result = await this.db.batch<{ count: number }>([
			this.db.prepare(`SELECT COUNT(*) as count FROM audit_logs WHERE chat_id = ?1`).bind(chatId),
			this.db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM user_infractions WHERE chat_id = ?1`).bind(chatId)
		]);
		return {
			total_actions: result[0].results[0]?.count || 0,
			unique_violators: result[1].results[0]?.count || 0
		};
	}

	async removeGroup(chatId: number): Promise<void> {
		await this.db.prepare(`DELETE FROM group_settings WHERE chat_id = ?1`).bind(chatId).run();
	}

	async cleanup(daysOld: number): Promise<void> {
		await this.db.batch([
			this.db.prepare(`DELETE FROM audit_logs WHERE timestamp < datetime('now', '-${daysOld} days')`),
			this.db.prepare(`DELETE FROM user_infractions WHERE last_violation < datetime('now', '-${daysOld} days')`)
		]);
	}
}
