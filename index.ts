import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type TabState = "working" | "waiting" | "done";

type ZellijPane = {
	id?: number;
	is_plugin?: boolean;
	tab_id?: number;
};

const ICONS: Record<TabState, string> = {
	working: "⏳",
	waiting: "🔴",
	done: "✅",
};

const DEFAULT_DONE_MS = 3000;

function isInsideZellij(): boolean {
	return Boolean(process.env.ZELLIJ_PANE_ID);
}

function getDoneDelayMs(): number {
	const raw = process.env.PI_ZELLIJ_DONE_MS;
	if (!raw) return DEFAULT_DONE_MS;

	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DONE_MS;
	return parsed;
}

function getTabLabel(pi: ExtensionAPI): string {
	const explicit = process.env.PI_ZELLIJ_TAB_LABEL?.trim();
	if (explicit) return explicit;

	const sessionName = pi.getSessionName()?.trim();
	if (sessionName) return sessionName;

	const cwdName = path.basename(process.cwd()).trim();
	return cwdName || "pi";
}

export default function (pi: ExtensionAPI) {
	let cachedTabId: string | null = null;
	let doneTimer: ReturnType<typeof setTimeout> | null = null;

	function clearDoneTimer() {
		if (!doneTimer) return;
		clearTimeout(doneTimer);
		doneTimer = null;
	}

	async function execZellij(args: string[]) {
		try {
			return await pi.exec("zellij", args);
		} catch {
			return null;
		}
	}

	async function detectCurrentTabId(): Promise<string | null> {
		if (!isInsideZellij()) return null;

		const paneId = Number(process.env.ZELLIJ_PANE_ID ?? -1);
		if (!Number.isInteger(paneId) || paneId < 0) return null;

		const result = await execZellij(["action", "list-panes", "--tab", "--json"]);
		if (!result || result.code !== 0 || !result.stdout.trim()) return null;

		let panes: ZellijPane[];
		try {
			panes = JSON.parse(result.stdout) as ZellijPane[];
		} catch {
			return null;
		}

		const pane = panes.find((candidate) => candidate.id === paneId && !candidate.is_plugin);
		if (!pane || typeof pane.tab_id !== "number") return null;

		return String(pane.tab_id);
	}

	async function getCurrentTabId(forceRefresh = false): Promise<string | null> {
		if (forceRefresh || !cachedTabId) {
			cachedTabId = await detectCurrentTabId();
		}
		return cachedTabId;
	}

	async function renameTab(title: string, forceRefresh = false): Promise<void> {
		if (!isInsideZellij()) return;

		let tabId = await getCurrentTabId(forceRefresh);
		if (!tabId) return;

		let result = await execZellij(["action", "rename-tab", "--tab-id", tabId, title]);
		if (result && result.code === 0) return;

		if (forceRefresh) return;

		cachedTabId = null;
		tabId = await getCurrentTabId(true);
		if (!tabId) return;

		await execZellij(["action", "rename-tab", "--tab-id", tabId, title]);
	}

	async function setTabState(state: TabState, forceRefresh = false): Promise<void> {
		const label = getTabLabel(pi);
		await renameTab(`${ICONS[state]} ${label}`, forceRefresh);
	}

	async function clearTabState(forceRefresh = false): Promise<void> {
		await renameTab(getTabLabel(pi), forceRefresh);
	}

	function scheduleWaitingState(ctx: ExtensionContext) {
		clearDoneTimer();

		const delayMs = getDoneDelayMs();
		if (delayMs === 0) {
			if (ctx.isIdle() && !ctx.hasPendingMessages()) {
				void setTabState("waiting");
			}
			return;
		}

		doneTimer = setTimeout(() => {
			doneTimer = null;
			if (ctx.isIdle() && !ctx.hasPendingMessages()) {
				void setTabState("waiting");
			}
		}, delayMs);
	}

	pi.on("session_start", async (_event, _ctx) => {
		cachedTabId = null;
		clearDoneTimer();
		await setTabState("waiting", true);
	});

	pi.on("agent_start", async (_event, _ctx) => {
		clearDoneTimer();
		await setTabState("working");
	});

	pi.on("agent_end", async (_event, ctx) => {
		clearDoneTimer();
		await setTabState("done");
		scheduleWaitingState(ctx);
	});

	pi.on("session_shutdown", async (_event, _ctx) => {
		clearDoneTimer();
		await clearTabState();
	});

	pi.registerCommand("zellij-tab-status", {
		description: "Refresh or manually set the Zellij tab status for this pane",
		handler: async (args, ctx) => {
			if (!isInsideZellij()) {
				ctx.ui.notify("Not inside a Zellij session.", "warning");
				return;
			}

			const next = args.trim().toLowerCase();
			if (!next || next === "refresh") {
				const idle = ctx.isIdle() && !ctx.hasPendingMessages();
				await setTabState(idle ? "waiting" : "working", true);
				ctx.ui.notify("Refreshed Zellij tab status.", "info");
				return;
			}

			if (next === "clear") {
				clearDoneTimer();
				await clearTabState(true);
				ctx.ui.notify("Cleared the Zellij tab status icon.", "info");
				return;
			}

			if (next !== "working" && next !== "waiting" && next !== "done") {
				ctx.ui.notify("Usage: /zellij-tab-status [refresh|working|waiting|done|clear]", "error");
				return;
			}

			clearDoneTimer();
			await setTabState(next, true);
			ctx.ui.notify(`Set Zellij tab status to ${next}.`, "info");
		},
	});
}
