export interface Env {
	DB: D1Database;
	KV: KVNamespace;
	QUEUE: Queue<QueuePayload>;
	TELEGRAM_BOT_TOKEN: string;
	TELEGRAM_SECRET_TOKEN: string;
}

export interface GroupSettings {
	chat_id: number;
	anti_link: number;
	anti_forward: number;
	anti_spam: number;
	anti_flood: number;
	max_warnings: number;
	log_channel_id: number | null;
}

export interface QueuePayload {
	logId: string;
	chatId: number;
	userId: number;
	action: string;
	metadata?: any;
}

export interface TelegramUser { 
	id: number; 
	is_bot: boolean; 
	first_name: string; 
	username?: string; 
}

export interface TelegramChat { 
	id: number; 
	type: string; 
	title?: string; 
}

export interface TelegramMessage {
	message_id: number;
	from: TelegramUser;
	chat: TelegramChat;
	date: number;
	text?: string;
	caption?: string;
	forward_origin?: any;
	new_chat_members?: TelegramUser[];
	left_chat_member?: TelegramUser;
	reply_to_message?: TelegramMessage;
	entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
	caption_entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
}

export interface ChatMemberUpdated {
	chat: TelegramChat;
	from: TelegramUser;
	date: number;
	old_chat_member: { status: string; user: TelegramUser };
	new_chat_member: { status: string; user: TelegramUser };
}

export interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	my_chat_member?: ChatMemberUpdated;
	callback_query?: { 
		id: string; 
		from: TelegramUser; 
		message?: TelegramMessage; 
		data?: string; 
	};
}
