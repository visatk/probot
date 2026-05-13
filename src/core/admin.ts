import { Env } from '../types';
import { TelegramClient } from './telegram';

export class AdminService {
	private requestCache = new Map<number, Set<number>>();

	constructor(private env: Env, private tg: TelegramClient) {}

	async getAdmins(chatId: number): Promise<Set<number>> {
		if (this.requestCache.has(chatId)) {
			return this.requestCache.get(chatId)!;
		}

		const cacheKey = `admins:${chatId}`;
		let adminsArr = await this.env.KV.get<number[]>(cacheKey, 'json');

		if (!adminsArr || adminsArr.length === 0) {
			adminsArr = await this.tg.getChatAdministrators(chatId);
			if (adminsArr.length > 0) {
				// 5 minute TTL for rapid edge validations
				await this.env.KV.put(cacheKey, JSON.stringify(adminsArr), { expirationTtl: 300 });
			}
		}

		const adminSet = new Set<number>(adminsArr || []);
		this.requestCache.set(chatId, adminSet);
		return adminSet;
	}

	async isAdmin(chatId: number, userId: number): Promise<boolean> {
		const adminSet = await this.getAdmins(chatId);
		return adminSet.has(userId);
	}
}
