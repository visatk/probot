export class TelegramClient {
	constructor(private token: string) {}

	async callApi(method: string, payload: any): Promise<Response | null> {
		try {
			// Fail-fast timeout to protect worker CPU/Memory limits
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 5000);

			const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				signal: controller.signal
			});
			
			clearTimeout(timeout);

			if (!response.ok) {
				console.error(`Telegram API Error (${method}):`, await response.text());
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
	async restrictChatMember(chatId: number, userId: number, permissions: any) { return this.callApi('restrictChatMember', { chat_id: chatId, user_id: userId, permissions }); }
	async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert: boolean = false) { return this.callApi('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: showAlert }); }
	
	async getChatAdministrators(chatId: number): Promise<number[]> {
		const res = await this.callApi('getChatAdministrators', { chat_id: chatId });
		if (!res || !res.ok) return [];
		const data = await res.json() as any;
		return data.result.map((member: any) => member.user.id);
	}
}
