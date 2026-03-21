import { escapeHtml } from "@/lib/security";

interface LoginPageOptions {
	error?: string;
	oauthEnabled?: boolean;
}

export function loginPage(options: LoginPageOptions = {}): string {
	const { error, oauthEnabled = false } = options;

	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>继续</title>
	<meta name="robots" content="noindex, nofollow" />
	<style>
		:root {
			color-scheme: light dark;
			--color-bg: #edf3f8;
			--color-text: #101828;
			--color-text-secondary: #3a4357;
			--color-border: rgba(15, 23, 42, 0.08);
			--color-accent: #0a84ff;
			--color-accent-hover: #0066cc;
			--card-surface-rgb: 255, 255, 255;
			--card-sheen-rgb: 255, 255, 255;
			--shadow-card:
				0 18px 40px -30px rgba(8, 18, 34, 0.18),
				0 6px 18px -12px rgba(8, 18, 34, 0.12);
			--radius-panel: 34px;
			--radius-pill: 999px;
			--glass-panel-opacity: 0.14;
			--glass-panel-blur: 18px;
			--font-sans:
				"SF Pro Display", "SF Pro Text", "PingFang SC", "Hiragino Sans GB",
				"Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		}

		@media (prefers-color-scheme: dark) {
			:root {
				--color-bg: #07111f;
				--color-text: #eef4ff;
				--color-text-secondary: #cad4e6;
				--color-border: rgba(147, 161, 188, 0.14);
				--color-accent: #57a6ff;
				--color-accent-hover: #88c0ff;
				--card-surface-rgb: 24, 36, 54;
				--card-sheen-rgb: 142, 178, 224;
			}
		}

		*,
		*::before,
		*::after {
			box-sizing: border-box;
		}

		html,
		body {
			margin: 0;
			min-height: 100vh;
		}

		body {
			display: grid;
			place-items: center;
			padding: 1rem;
			font-family: var(--font-sans);
			color: var(--color-text);
			background:
				radial-gradient(circle at 14% 10%, rgba(126, 192, 255, 0.14), transparent 24%),
				radial-gradient(circle at 84% 12%, rgba(255, 255, 255, 0.24), transparent 20%),
				radial-gradient(circle at 48% 100%, rgba(88, 192, 255, 0.08), transparent 26%),
				linear-gradient(180deg, rgba(255, 255, 255, 0.3), transparent 30%),
				var(--color-bg);
		}

		body::before,
		body::after {
			content: "";
			position: fixed;
			width: 24rem;
			height: 24rem;
			border-radius: 50%;
			filter: blur(70px);
			opacity: 0.24;
			pointer-events: none;
			z-index: -1;
		}

		body::before {
			top: -6rem;
			left: -6rem;
			background: rgba(125, 171, 255, 0.32);
		}

		body::after {
			right: -8rem;
			bottom: 8rem;
			background: rgba(255, 255, 255, 0.24);
		}

		.entry-shell {
			width: min(560px, calc(100vw - 1rem));
		}

		.entry-panel {
			position: relative;
			overflow: hidden;
			background: transparent;
			border: 1px solid rgba(255, 255, 255, 0.18);
			border-radius: var(--radius-panel);
			box-shadow: var(--shadow-card);
		}

		.entry-panel::after {
			content: "";
			position: absolute;
			inset: 0;
			border-radius: inherit;
			--glass-panel-blur-effective: min(
				calc(var(--glass-panel-blur, 18px) * 1.35),
				72px
			);
			background: rgba(
				var(--card-surface-rgb),
				calc(var(--glass-panel-opacity, 0.14) * 0.82)
			);
			backdrop-filter: blur(var(--glass-panel-blur-effective)) saturate(145%);
			-webkit-backdrop-filter: blur(var(--glass-panel-blur-effective))
				saturate(145%);
			pointer-events: none;
			z-index: 0;
		}

		.entry-panel::before {
			content: "";
			position: absolute;
			inset: 0;
			border-radius: inherit;
			background: linear-gradient(
				180deg,
				rgba(var(--card-sheen-rgb), 0.12),
				rgba(var(--card-sheen-rgb), 0.03) 22%,
				transparent 100%
			);
			pointer-events: none;
			opacity: 0.7;
			z-index: 1;
		}

		.entry-content {
			position: relative;
			z-index: 2;
			display: grid;
			gap: 0.9rem;
			padding: clamp(1.15rem, 0.9rem + 1.1vw, 1.65rem);
		}

		.entry-brand {
			display: inline-flex;
			align-items: center;
			gap: 0.58rem;
			width: fit-content;
			color: inherit;
			text-decoration: none;
			font-weight: 700;
			letter-spacing: 0.01em;
		}

		.entry-brand-dot {
			width: 0.72rem;
			height: 0.72rem;
			border-radius: 999px;
			background: var(--color-accent);
			box-shadow: 0 0 0 5px color-mix(in srgb, var(--color-accent) 16%, transparent);
		}

		.entry-title {
			margin: 0;
			font-size: clamp(1.45rem, 1.2rem + 0.85vw, 1.95rem);
			line-height: 1.25;
		}

		.entry-muted {
			margin: 0;
			color: var(--color-text-secondary);
			font-size: 0.95rem;
			line-height: 1.75;
		}

		.entry-error {
			margin: 0;
			padding: 0.72rem 0.88rem;
			border-radius: 14px;
			border: 1px solid rgba(220, 38, 38, 0.25);
			background: rgba(220, 38, 38, 0.1);
			color: #dc2626;
			line-height: 1.7;
		}

		.entry-actions {
			display: flex;
			flex-wrap: wrap;
			gap: 0.65rem;
		}

		.entry-btn {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: 0.4rem;
			padding: 0.82rem 1.18rem;
			border-radius: var(--radius-pill);
			text-decoration: none;
			font-size: 0.93rem;
			font-weight: 600;
			transition:
				transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
				box-shadow 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
				opacity 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
		}

		.entry-btn:hover {
			transform: translateY(-1px);
		}

		.entry-btn-primary {
			border: 1px solid rgba(10, 132, 255, 0.12);
			background: var(--color-accent);
			color: #f8fbff;
			box-shadow: 0 14px 32px -24px rgba(10, 132, 255, 0.45);
		}

		.entry-btn-primary:hover {
			color: #ffffff;
			background: var(--color-accent-hover);
			box-shadow: 0 18px 36px -24px rgba(10, 132, 255, 0.4);
		}

		.entry-btn-primary[aria-disabled="true"] {
			opacity: 0.45;
			pointer-events: none;
			box-shadow: none;
		}

		.entry-btn-ghost {
			border: 1px solid var(--color-border);
			background: rgba(255, 255, 255, 0.42);
			color: var(--color-text-secondary);
		}

		@media (prefers-color-scheme: dark) {
			.entry-btn-ghost {
				background: rgba(15, 27, 43, 0.52);
			}
		}

		@media (max-width: 560px) {
			.entry-actions {
				flex-direction: column;
			}

			.entry-btn {
				width: 100%;
			}
		}
	</style>
</head>
<body>
	<main class="entry-shell">
		<section class="entry-panel">
			<div class="entry-content">
				<a href="/" class="entry-brand" aria-label="返回首页">
					<span class="entry-brand-dot" aria-hidden="true"></span>
					<span>EricTerminal Blog</span>
				</a>
				<h1 class="entry-title">欢迎回来</h1>
				<p class="entry-muted">继续</p>
				${error ? `<p class="entry-error" role="alert">${escapeHtml(error)}</p>` : ""}
				<div class="entry-actions">
					<a
						href="/api/auth/github"
						class="entry-btn entry-btn-primary"
						aria-disabled="${oauthEnabled ? "false" : "true"}"
					>
						使用 GitHub 继续
					</a>
					<a href="/" class="entry-btn entry-btn-ghost">返回首页</a>
				</div>
			</div>
		</section>
	</main>
</body>
</html>`;
}
