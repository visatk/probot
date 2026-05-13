import { Env } from '../types';
import { TelegramClient } from './telegram';

export class AdminService {
	private requestCache = new Map<number, number[]>();

	constructor(private env: Env, private tg: TelegramClient) {}

	async getAdmins(chatId: number): Promise<number[]> {
		if (this.requestCache.has(chatId)) {
			return this.requestCache.get(chatId)!;
		}

		const cacheKey = `admins:${chatId}`;
		let admins = await this.env.KV.get<number[]>(cacheKey, 'json');

		if (!admins || admins.length === 0) {
			admins = await this.tg.getChatAdministrators(chatId);
			if (admins.length > 0) {
				await this.env.KV.put(cacheKey, JSON.stringify(admins), { expirationTtl: 300 });
			}
		}

		this.requestCache.set(chatId, admins || []);
		return admins || [];
	}

	async isAdmin(chatId: number, userId: number): Promise<boolean> {
		const admins = await this.getAdmins(chatId);
		return admins.includes(userId);
	}
}
