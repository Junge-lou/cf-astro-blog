/**
 * 首页 Hero 侧栏的「按高度定个数」脚本。
 *
 * 背景：`.hero-body`（文案列）与 `.hero-sidebar`（卡片列）在宽屏下并排成两列，
 * 网格行高取两者较大值。侧栏若写死张数，就总会有一列贴顶留白；若为了不留白而
 * 写死更多张，文案短时侧栏又会比正文高、把整个 Hero 面板顶高。
 *
 * 所以侧栏的做法是：置顶固定 1 张，最新文章在 SSR 时多渲染几张候选并全部隐藏，
 * 布局完成后由本脚本实测 `.hero-body` 的高度，二分出「能塞进这个高度的最大张数」。
 * 窄屏（< 768px，与 CSS 断点一致）保持固定两张：置顶 1 张 + 最新 1 张。
 *
 * 与页面其余部分的约定（改结构时务必同步）：
 * - 侧栏容器必须有 `data-hero-sidebar-fit`；
 * - 候选卡（index.astro 里 `heroSidebarPosts.map` 渲染的那批）必须有
 *   `data-hero-sidebar-post=<序号>` 与 `data-sidebar-hidden`（后者由模板直接输出，
 *   避免脚本执行前先闪一下）；
 * - 置顶卡不带这两个属性，因此永远显示、且不参与计数。
 */
(() => {
	const WIDE_QUERY = "(min-width: 768px)";
	/** 窄屏（单列）固定显示的最新一代张数。 */
	const NARROW_VISIBLE_POSTS = 1;
	const SIDEBAR_SELECTOR = "[data-hero-sidebar-fit]";
	const BODY_SELECTOR = ".hero-body";
	const CARD_SELECTOR = "[data-hero-sidebar-post]";
	const HIDDEN_ATTR = "data-sidebar-hidden";

	const measureQuery = window.matchMedia(WIDE_QUERY);
	let active = false;
	let scheduled = false;
	let lastWide = null;

	const sidebarElement = () => {
		const sidebar = document.querySelector(SIDEBAR_SELECTOR);
		return sidebar instanceof HTMLElement ? sidebar : null;
	};

	const cardsOf = (sidebar) => Array.from(sidebar.querySelectorAll(CARD_SELECTOR));

	const setCardHidden = (card, shouldHide) => {
		if (shouldHide) {
			card.setAttribute(HIDDEN_ATTR, "true");
			return;
		}

		card.removeAttribute(HIDDEN_ATTR);
	};

	/** 把「显示前 count 张」落到 DOM 上。 */
	const layout = (cards, count) => {
		for (let index = 0; index < cards.length; index += 1) {
			setCardHidden(cards[index], index >= count);
		}
	};

	const showAll = (cards) => {
		for (const card of cards) {
			card.removeAttribute(HIDDEN_ATTR);
		}
	};

	/** 二分：找出「显示 k 张后侧栏仍在正文高度以内」的最大 k。 */
	const fitCount = (sidebar, body, cards) => {
		const bodyHeight = body.getBoundingClientRect().height;

		if (!(bodyHeight > 0)) {
			return cards.length;
		}

		let low = 0;
		let high = cards.length;

		while (low < high) {
			const mid = Math.ceil((low + high) / 2);
			layout(cards, mid);

			if (sidebar.getBoundingClientRect().height <= bodyHeight) {
				low = mid;
			} else {
				high = mid - 1;
			}
		}

		return low;
	};

	const report = () => {
		const sidebar = sidebarElement();
		const body = sidebar?.parentElement?.querySelector(BODY_SELECTOR);
		const cards = sidebar ? cardsOf(sidebar) : [];

		if (!sidebar || !(body instanceof HTMLElement) || cards.length === 0) {
			return;
		}

		const pinnedCount = sidebar.querySelectorAll(":scope > article").length - cards.length;
		const fitted = fitCount(sidebar, body, cards);
		// 至少要有一张最新文章，否则侧栏只剩置顶卡、那片空白又回来了
		layout(cards, pinnedCount > 0 ? Math.max(1, fitted) : fitted);
	};

	const schedule = () => {
		if (scheduled) {
			return;
		}

		scheduled = true;
		window.requestAnimationFrame(() => {
			scheduled = false;
			report();
		});
	};

	const reset = () => {
		const sidebar = sidebarElement();

		if (sidebar) {
			showAll(cardsOf(sidebar));
		}
	};

	const resizeObserver = new ResizeObserver(schedule);

	const start = () => {
		const sidebar = sidebarElement();
		const body = sidebar?.parentElement?.querySelector(BODY_SELECTOR);

		if (active || !measureQuery.matches || !sidebar || !(body instanceof HTMLElement)) {
			return;
		}

		active = true;
		reset();
		schedule();
		resizeObserver.observe(body);
		window.addEventListener("resize", schedule);
		window.addEventListener("load", schedule);
	};

	const stop = () => {
		if (!active) {
			return;
		}

		active = false;
		resizeObserver.disconnect();
		window.removeEventListener("resize", schedule);
		window.removeEventListener("load", schedule);
		// 这里刻意不动 DOM：要么页面即将被替换，要么 applyViewport 紧接着会
		// 按窄屏规则重新 layout。若在这里 showAll，切页瞬间会闪出一堆候选卡。
	};

	/** 窄屏固定张数；宽屏交给测量。 */
	const applyViewport = () => {
		const isWide = measureQuery.matches;

		if (isWide === lastWide) {
			return;
		}

		lastWide = isWide;

		if (isWide) {
			start();
			return;
		}

		stop();
		const sidebar = sidebarElement();

		if (sidebar) {
			layout(cardsOf(sidebar), NARROW_VISIBLE_POSTS);
		}
	};

	const boot = () => {
		lastWide = null;
		applyViewport();
		start();
	};

	measureQuery.addEventListener("change", applyViewport);
	document.addEventListener("astro:before-swap", stop);
	document.addEventListener("astro:page-load", boot);

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot, { once: true });
	} else {
		boot();
	}
})();
