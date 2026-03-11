/// <reference types="astro/client" />

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

interface Env {
	DB: D1Database;
	MEDIA_BUCKET: R2Bucket;
	SESSION: KVNamespace;
	ASSETS: Fetcher;

	SITE_NAME: string;
	SITE_URL: string;
	TURNSTILE_SITE_KEY: string;
	AUTO_DEPLOY_WEBHOOK_URL?: string;
	AUTO_DEPLOY_WEBHOOK_SECRET?: string;
	AUTO_DEPLOY_GITHUB_EVENT_TYPE?: string;

	JWT_SECRET: string;
	ADMIN_USERNAME: string;
	ADMIN_GITHUB_LOGIN: string;
	ADMIN_PASSWORD_HASH: string;
	TURNSTILE_SECRET_KEY: string;
	GITHUB_OAUTH_CLIENT_ID: string;
	GITHUB_OAUTH_CLIENT_SECRET: string;
	GITHUB_OAUTH_REDIRECT_URI: string;
}

declare namespace App {
	interface Locals extends Runtime {}
}
