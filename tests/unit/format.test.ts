import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { estimateArticleReadStats } from "../../src/lib/format";

describe("文章字数与阅读时长估算", () => {
	test("中英文混排会分别统计字与词", () => {
		const stats = estimateArticleReadStats("你好世界 hello world");

		assert.equal(stats.cjkCharCount, 4);
		assert.equal(stats.latinWordCount, 2);
		assert.equal(stats.estimatedReadingMinutes, 1);
	});

	test("代码块内容不会计入统计", () => {
		const stats = estimateArticleReadStats(
			"正文 one two\n```ts\nshould not count words 中文\n```\n结尾 three",
		);

		assert.equal(stats.cjkCharCount, 4);
		assert.equal(stats.latinWordCount, 3);
		assert.equal(stats.estimatedReadingMinutes, 1);
	});

	test("会按公式估算阅读分钟数", () => {
		const chineseContent = "字".repeat(900);
		const englishContent = Array.from({ length: 200 }, (_, index) => `word${index}`).join(" ");
		const stats = estimateArticleReadStats(`${chineseContent}\n\n${englishContent}`);

		assert.equal(stats.cjkCharCount, 900);
		assert.equal(stats.latinWordCount, 200);
		assert.equal(stats.estimatedReadingMinutes, 4);
	});

	test("空内容至少显示 1 分钟", () => {
		const stats = estimateArticleReadStats("   ");

		assert.equal(stats.cjkCharCount, 0);
		assert.equal(stats.latinWordCount, 0);
		assert.equal(stats.estimatedReadingMinutes, 1);
	});
});
