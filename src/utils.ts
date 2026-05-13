export function escapeHtml(unsafe: string | undefined | null): string {
	if (!unsafe) return '';
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

export function isAdvancedSpam(text: string): boolean {
	if (!text) return false;
	
	// 1. Repeated character/pattern spam (e.g., >15 identical chars)
	if (/(.)\1{15,}/.test(text)) return true;
	
	// 2. Pattern spam (repeated phrases resulting in low diversity)
	const words = text.split(/\s+/).filter(w => w.length > 2);
	if (words.length > 10) {
		const uniqueWords = new Set(words.map(w => w.toLowerCase()));
		if (uniqueWords.size / words.length < 0.3) return true; // Less than 30% vocabulary diversity
	}
	
	// 3. Excessive caps (more than 70% uppercase in long strings)
	const uppercaseCount = (text.match(/[A-Z]/g) || []).length;
	if (text.length > 20 && uppercaseCount / text.length > 0.7) return true;

	return false;
}

export function containsHiddenLink(text: string): boolean {
	if (!text) return false;
	// Regex catches obfuscated links like example(dot)com or http://
	const linkRegex = /(https?:\/\/|www\.)|([a-zA-Z0-9-]+\.(com|net|org|io|me|t\.me)(\/|\b))|(\w+\s*\(dot\)\s*\w+)/i;
	return linkRegex.test(text);
}
