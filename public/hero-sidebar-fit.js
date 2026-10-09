/**
 * 首页 Hero 侧栏的「按高度定张数 + 定卡片高度」脚本。
 *
 * 背景：`.hero-body`（文案列）与 `.hero-sidebar`（卡片列）在宽屏下并排成两列，
 * 网格行高取两者较大值。侧栏若写死张数，就总会有一列贴顶留白；若为了不留白而
 * 写死更多张，文案短时侧栏又会比正文高、把整个 Hero 面板顶高。
 *
 * 现在的约定是：**卡片高度是「张数」与「可用高度」的函数**。
 * - 侧栏容器高度由 `.hero-body` 撑开（窄屏 min-height 兜底），卡片 flex 均分剩余空间；
 * - 本脚本先做一次校准：把卡片基线置 0，量出「全部候选都可见时的自然高度」与单张卡
 *   的自然高度，换算出每多显示一张卡需要的高度增量（gap + 卡片自身高度）；
 * - 再自「满配张数」向下试算：把 `.hero-body` 的高度按张数平均分配，
 *   每张卡分到的高度落在 CARD_MIN_HEIGHT..CARD_MAX_HEIGHT 之间就用这个张数；
 * - 分到的高度跌破下限说明这个张数塞不下，于是减少候选张数；
 *   分到的高度超过上限说明内容撑不出这么高，改用自然高度（宁可侧栏略高也不留空壳）；
 * - 结果通过 `--hero-sidebar-card-row` 写回 DOM，CSS 用它把每张卡等比拉伸。
 *
 * 窄屏（< 768px，与 CSS 断点一致）固定显示 NARROW_VISIBLE_POSTS 张最新文章。
 *
 * 与页面其余部分的约定（改结构时务必同步）：
 * - 侧栏容器必须有 `data-hero-sidebar-fit`；
 * - 候选卡（index.astro 里 `heroSidebarPosts.map` 渲染的那批）必须有
 *   `data-hero-sidebar-post=<序号>` 与 `data-sidebar-hidden`（后者由模板直接输出，
 *   避免脚本执行前先闪一下）；
 * - 置顶卡不带这两个属性，因此永远显示、且不参与计数；
 * - CSS 取值必须与下面的常量对齐：index.astro 的 `.hero-sidebar`
 *   （宽屏 gap 0.35rem / padding 0.45rem）与 `.hero-sidebar > :global(article)`
 *   的 --hero-sidebar-card-min / --hero-sidebar-card-max。
 */
(() => {
	const WIDE_QUERY = "(min-width: 768px)";
	/** 侧栏可见卡片总数上限（置顶 + 最新），与 index.astro 的 HERO_SIDEBAR_MAX_POSTS 一致。 */
	const MAX_VISIBLE_POSTS = 5;
	/** 窄屏（单列）固定显示的最新文章张数（置顶卡不受影响，照常全部显示）。 */
	const NARROW_VISIBLE_POSTS = 1;
	/** 宽屏侧栏的 gap（CSS 0.35rem = 5.6px）与内边距（CSS 0.45rem = 7.2px）。 */
	const GAP = 5.6;
	const PADDING = 7.2;
	/** 单张卡片的可用高度区间，必须与 CSS 的 --hero-sidebar-card-min / --card-max 一致。 */
	const CARD_MIN_HEIGHT = 76;
	const CARD_MAX_HEIGHT = 208;
	/** 换算不出「每多一张卡的高度增量」时的兜底值。 */
	const FALLBACK_PER_CARD = CARD_MIN_HEIGHT + GAP;
	const SIDEBAR_SELECTOR = "[data-hero-sidebar-fit]";
	const BODY_SELECTOR = ".hero-body";
	const CARD_SELECTOR = "[data-hero-sidebar-post]";
	const HIDDEN_ATTR = "data-sidebar-hidden";
	/** 卡片实际拿到的「基础高度」（px）：CSS 用它把每张卡按比例拉伸。 */
	const ROW_VAR = "--hero-sidebar-card-row";

	const measureQuery = window.matchMedia(WIDE_QUERY);
	let active = false;
	let scheduled = false;
	let lastWide = null;

	const sidebarElement = () => {
		const sidebar = document.querySelector(SIDEBAR_SELECTOR);
		return sidebar instanceof HTMLElement ? sidebar : null;
	};

	const cardsOf = (sidebar) => Array.from(sidebar.querySelectorAll(CARD_SELECTOR));

	/** 置顶卡不参与计数，但既占高度也占一格 gap。 */
	const pinnedOf = (sidebar, cards) =>
		Array.from(sidebar.children).filter((node) => !cards.includes(node));

	const setCardHidden = (card, shouldHide) => {
		if (shouldHide) {
			card.setAttribute(HIDDEN_ATTR, "true");
			return;
		}

		card.removeAttribute(HIDDEN_ATTR);
	};

	const setBaseline = (sidebar, cards, baseline) => {
		if (baseline === null) {
			sidebar.style.removeProperty(ROW_VAR);
		} else {
			sidebar.style.setProperty(ROW_VAR, `${baseline.toFixed(2)}px`);
		}

		for (const card of cards) {
			if (baseline === null || card.hasAttribute(HIDDEN_ATTR)) {
				card.style.removeProperty(ROW_VAR);
				continue;
			}

			card.style.setProperty(ROW_VAR, `${baseline.toFixed(2)}px`);
		}
	};

	/**
	 * 校准：量出两个实测量，后续所有高度都由它们推算。
	 *
	 *   候选卡自然高度（每张）  = 实测自然高
	 *   置顶部分高度（固定）    = 置顶卡高 + gap + 内边距
	 *
	 * 侧栏在某张数下的自然高度 = 置顶固定高 + (自然卡高 + gap) × 张数 ——
	 * 其中「自然卡高 + gap」正是每多显示一张卡要多占的高度。
	 *
	 * 校准必须在「全部候选都可见」的状态下做：否则最后一张卡少一格 gap，
	 * 量出来的每张卡高度就不准了。
	 */
	const calibrate = (sidebar, cards) => {
		const pinned = pinnedOf(sidebar, cards);

		for (const card of cards) {
			card.removeAttribute(HIDDEN_ATTR);
		}

		sidebar.style.setProperty(ROW_VAR, "0px");
		const pinnedHeight = pinned.reduce((sum, card) => sum + card.getBoundingClientRect().height, 0);
		const candidateTotal = cards.reduce((sum, card) => sum + card.getBoundingClientRect().height, 0);
		const candidateHeight =
			cards.length > 0 && candidateTotal > 0 ? candidateTotal / cards.length : 0;
		const naturalCardHeight = candidateHeight > 0 ? candidateHeight : CARD_MIN_HEIGHT;
		// 「置顶部分」= 置顶卡高 + 置顶卡各占一格 gap + 上下 padding；
		// n 张候选时侧栏总高 = 置顶部分 + (自然卡高 + gap) × n − 半格收尾……
		// 这里只需记住两件事：每多一张候选卡多占 perCard 高，其余是与 n 无关的 top。
		const top =
			pinnedHeight + GAP * pinned.length + PADDING * 2;
		const perCard = naturalCardHeight + GAP;

		return { naturalCardHeight, perCard, top };
	};

	/**
	 * 把「显示前 count 张」+「每张多高」一次落到 DOM 上。
	 * 两个量必须同时写：卡片高度由可见张数决定，反过来又决定高度是否够用。
	 */
	const layout = (sidebar, cards, count, rowHeight) => {
		for (let index = 0; index < cards.length; index += 1) {
			setCardHidden(cards[index], index >= count);
		}

		setBaseline(sidebar, cards.slice(0, count), rowHeight);
	};

	/**
	 * 求「最多能显示几张 ／ 每张多高」。
	 *
	 * n 张候选时把可用高度平均分给 n 张 —— 这就是「卡片高度是张数与可用高度的函数」：
	 *
	 *   每张卡的高度 = (正文高度 - top) / n - gap
	 *
	 * （top = 置顶部分高度；n 张候选之间共 n-1 格 gap，所以是 + gap 的收支。）
	 * 分到的高度不低于下限就用这一档；自然高度已经顶出正文高度的档位直接跳过，
	 * 张数越少越装得下，所以第一个通过的档位就是最大张数。
	 *
	 * 上限是「夹」而不是「减张数」：分到的高度超过上限说明正文特别高，这时张数
	 * 取满、高度夹到上限，多出来的空间留在底部；若为了填满而减张数，侧栏会变成
	 * 几张大空壳，比留白更难看。
	 */
	const chooseCount = (bodyHeight, cards, countLimit, perCard, top) => {
		// 自然高度已顶出正文的档位不必再试
		const maxCount = Math.min(countLimit, Math.max(0, Math.floor((bodyHeight - top) / perCard)));

		for (let count = maxCount; count > 0; count -= 1) {
			const share = (bodyHeight - top + GAP) / count - GAP;

			if (share >= CARD_MIN_HEIGHT) {
				return { count, rowHeight: Math.min(share, CARD_MAX_HEIGHT) };
			}
		}

		// 一档都放不进下限：能挤出下限高度就显示一张并压到下限，否则按自然高度
		const squeezed = bodyHeight - top;
		const fallback = countLimit > 0 && squeezed >= CARD_MIN_HEIGHT;

		return {
			count: countLimit > 0 ? 1 : 0,
			rowHeight: fallback ? Math.min(squeezed, CARD_MAX_HEIGHT) : null,
		};
	};

	/** 由「置顶部分高度 / 每张卡高」反推置顶张数：总张数上限要扣掉它们。 */
	const pinnedCountOf = (perCard, top) => Math.round(Math.max(0, top) / perCard);

	const report = () => {
		const sidebar = sidebarElement();
		const body = sidebar?.parentElement?.querySelector(BODY_SELECTOR);
		const cards = sidebar ? cardsOf(sidebar) : [];

		if (!sidebar || !(body instanceof HTMLElement) || cards.length === 0) {
			return;
		}

		const bodyHeight = body.getBoundingClientRect().height;

		if (!(bodyHeight > 0)) {
			return;
		}

		const { perCard, top } = calibrate(sidebar, cards);
		const countLimit = Math.min(
			cards.length,
			Math.max(0, MAX_VISIBLE_POSTS - pinnedCountOf(perCard, top)),
		);
		const { count, rowHeight } = chooseCount(bodyHeight, cards, countLimit, perCard, top);
		layout(sidebar, cards, count, rowHeight);
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

		if (!sidebar) {
			return;
		}

		const cards = cardsOf(sidebar);
		showAll(cards);
		setBaseline(sidebar, cards, null);
	};

	const showAll = (cards) => {
		for (const card of cards) {
			card.removeAttribute(HIDDEN_ATTR);
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

	/** 窄屏固定张数（自然高度）；宽屏交给测量。 */
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
			layout(sidebar, cardsOf(sidebar), NARROW_VISIBLE_POSTS, null);
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
