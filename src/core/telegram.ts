export class TelegramClient {
	constructor(private token: string) {}

	async callApi(method: string, payload: any, retries = 1): Promise<Response | null> {
		try {
			const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(6000)
			});
			
			if (!response.ok) {
				const status = response.status;
				const errorData = await response.json() as any;
				
				// 429 Rate Limit Handling Protocol
				if (status === 429 && retries > 0) {
					const retryAfter = errorData.parameters?.retry_after || 1;
					// Cap sleep to 3 seconds to avoid worker isolate death
					if (retryAfter <= 3) {
						await new Promise(res => setTimeout(res, retryAfter * 1000));
						return this.callApi(method, payload, retries - 1);
					}
				}
				console.error(`Telegram API Error (${method}):`, errorData);
			}
			return response;
		} catch (error) {
			console.error(`Fetch Error (${method}):`, error);
			return null;
		}
	}

	async deleteMessage(chatId: number, messageId: number) { return this.callApi('deleteMessage', { chat_id: chatId, message_id: messageId }); }
	async sendMessage(chatId: number, text: string, replyMarkup?: any) { return this.callApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: replyMarkup }); }
	async editMessageText(chatId: number, messageId: number, text: string, replyMarkup?: any) { return this.callApi('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: replyMarkup }); }
	async banChatMember(chatId: number, userId: number) { return this.callApi('banChatMember', { chat_id: chatId, user_id: userId, revoke_messages: true }); }
	async unbanChatMember(chatId: number, userId: number) { return this.callApi('unbanChatMember', { chat_id: chatId, user_id: userId, only_if_banned: true }); }
	async restrictChatMember(chatId: number, userId: number, permissions: any) { return this.callApi('restrictChatMember', { chat_id: chatId, user_id: userId, permissions }); }
	async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert: boolean = false) { return this.callApi('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: showAlert }); }
	
	async getChatAdministrators(chatId: number): Promise<number[]> {
		const res = await this.callApi('getChatAdministrators', { chat_id: chatId });
		if (!res || !res.ok) return [];
		const data = await res.json() as any;
		return data.result.map((member: any) => member.user.id);
	}
}
