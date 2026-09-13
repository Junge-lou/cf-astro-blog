const zhDateFormatter = new Intl.DateTimeFormat("zh-CN", {
	year: "numeric",
	month: "long",
	day: "numeric",
});

const CJK_CHAR_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu;
const LATIN_WORD_PATTERN = /[a-zA-Z0-9]+(?:['’-][a-zA-Z0-9]+)*/gu;

function extractReadableText(markdown: string): string {
	return markdown
		.replaceAll(/```[\s\S]*?```/g, " ")
		.replaceAll(/~~~[\s\S]*?~~~/g, " ")
		.replaceAll(/`[^`\n]*`/g, " ")
		.replaceAll(/!\[[^\]]*]\([^)]+\)/g, " ")
		.replaceAll(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replaceAll(/<[^>]+>/g, " ")
		.replaceAll(/(^|\n)\s{0,3}(#{1,6}|>|[*+-]|\d+\.)\s+/g, "$1")
		.replaceAll(/[*_~]/g, " ")
		.replaceAll(/&[a-zA-Z0-9#]+;/g, " ")
		.replaceAll(/\s+/g, " ")
		.trim();
}

export interface ArticleReadStats {
	cjkCharCount: number;
	latinWordCount: number;
	estimatedReadingMinutes: number;
}

export function estimateArticleReadStats(markdown: string): ArticleReadStats {
	const readableText = extractReadableText(markdown);
	const cjkCharCount = readableText.match(CJK_CHAR_PATTERN)?.length ?? 0;
	const latinWordCount = readableText.match(LATIN_WORD_PATTERN)?.length ?? 0;
	const estimatedReadingMinutes = Math.max(1, Math.ceil(cjkCharCount / 300 + latinWordCount / 200));

	return {
		cjkCharCount,
		latinWordCount,
		estimatedReadingMinutes,
	};
}

export function formatDate(date: string | Date) {
	const value = typeof date === "string" ? new Date(date) : date;

	return zhDateFormatter.format(value);
}
