window.__ModuleLoader__.load({
	id: "dsh-session-delete",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region client/main.js
		/**
		* dsh-session-delete — 客户端半（浏览器）
		*
		* 1. 向 Typert 网关挂载 `sessionDelete/delete` 端点描述；
		* 2. 侧边栏会话行「…」菜单（sidebar.workspaces.session.menu.item）加一项
		*    「删除会话」——点击后**不再二次点击确认**，而是关掉菜单、弹出框架级
		*    确认弹窗（shell.overlay + UI primitives 的 Modal/Button），与官方
		*    「删除工作区」的交互和样式完全一致；
		* 3. 确认后调用宿主永久删除，成功后客户端会话列表立即移除该行。
		*
		* 结构对照官方同款（@deepseek-ai/dsh-experimental-client-ui-voice-input）：
		* 父 fiber 只 inject ["remote","slots","locale"] 并负责 $mount；命名空间
		* `remote.sessionDelete` 是本插件自己创建的，按 cordis 规则读它必须发生在
		* **声明了该 inject 的子 fiber** 内（ctx.inject），否则会抛
		* `cannot get property "remote.sessionDelete" without inject`。
		*/
		const jsx = react_jsx_runtime.jsx;
		const jsxs = react_jsx_runtime.jsxs;
		const Fragment = react_jsx_runtime.Fragment;
		const NS = "session-delete";
		const zh = {
			"menu.delete": "删除会话",
			"dialog.title": "删除会话",
			"dialog.desc": "「{name}」及其全部聊天记录会被永久删除，且无法恢复。",
			"dialog.untitled": "该会话",
			"dialog.cancel": "取消",
			"dialog.confirm": "删除",
			"dialog.deleting": "删除中…",
			"error.open": "该会话正在使用中，请先切换到其他会话再删除。",
			"error.notFound": "未找到该会话（可能已删除）。",
			"error.failed": "删除失败：{message}"
		};
		const en = {
			"menu.delete": "Delete session",
			"dialog.title": "Delete session",
			"dialog.desc": "“{name}” and its entire chat history will be permanently deleted. This cannot be undone.",
			"dialog.untitled": "This session",
			"dialog.cancel": "Cancel",
			"dialog.confirm": "Delete",
			"dialog.deleting": "Deleting…",
			"error.open": "This session is in use; switch to another session first.",
			"error.notFound": "Session not found (it may already be deleted).",
			"error.failed": "Delete failed: {message}"
		};
		/** 编解码：直传 JSON（宿主端自行校验）。
		* 0.2.x 的 strict codec 必须提供 create() 工厂，故不用 schema 字段。 */
		const passthroughCodec = () => ({
			mode: "strict",
			typeSymbol: "dsh-session-delete#json",
			create: () => ({ parse: (value) => value })
		});
		const contribution = {
			package: "dsh-session-delete",
			descriptors: [{
				id: "dsh-session-delete#sessionDelete/delete",
				service: "sessionDelete",
				namespace: "sessionDelete",
				method: "delete",
				invocation: { kind: "direct" },
				parameters: [{
					name: "request",
					wire: "request",
					source: "json",
					codec: passthroughCodec()
				}],
				result: passthroughCodec()
			}]
		};
		/* ─────────── 弹窗状态：菜单项与 shell.overlay 宿主共享 ───────────
		* 框架的 `inject().hooks.<name>` 要求传入**可订阅快照源**
		* （`getSnapshot()` + `subscribe(fn) → unsubscribe`），不是 React Hook；
		* 渲染器会把它包成 `use<Name>(selector)` 交给组件（见
		* dsh-client-ui-renderer 的 bindInjectSources / bindSnapshotSelector）。
		* 快照对象只在变更时换新身份，`useSyncExternalStore` 才能正确重渲染。 */
		let snapshot = {
			open: false,
			sessionId: "",
			title: "",
			busy: false,
			error: null
		};
		const subscribers = new Set();
		const deleteState = {
			getSnapshot: () => snapshot,
			subscribe: (notify) => {
				subscribers.add(notify);
				return () => {
					subscribers.delete(notify);
				};
			}
		};
		function publish(patch) {
			snapshot = { ...snapshot, ...patch };
			for (const notify of [...subscribers]) notify();
		}
		function openConfirm(sessionId, title) {
			publish({
				open: true,
				sessionId,
				title: typeof title === "string" ? title : "",
				busy: false,
				error: null
			});
		}
		function closeConfirm() {
			publish({
				open: false,
				sessionId: "",
				title: "",
				busy: false,
				error: null
			});
		}
		/** 危险色按钮样式（官方「删除工作区」同款：outline + error 文本色）。 */
		const STYLE_ID = "dsh-session-delete-style";
		function ensureStyle() {
			if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
			const tag = document.createElement("style");
			tag.id = STYLE_ID;
			tag.textContent = [
				".dsh-sd-danger:not(:disabled){color:var(--dsw-alias-state-error-primary)}",
				".dsh-sd-danger:not(:disabled):hover{color:var(--dsw-alias-state-error-primary)}",
				".dsh-sd-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}",
				".dsh-sd-status{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}"
			].join("");
			document.head.appendChild(tag);
		}
		/** 错误码 → 本地化文案 */
		function errorText(t, code, message) {
			if (code === "session-open") return t("error.open");
			if (code === "not-found") return t("error.notFound");
			return t("error.failed", { message: message || code || "unknown" });
		}
		/** 「…」菜单里的删除项：只负责发起确认，不再两段式点击。 */
		function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, openDialog, t }) {
			const [, setMenuOpen] = useMenuOpenState();
			return jsx(_deepseek_ai_dsh_client_ui_primitives.MenuItemButton, {
				danger: true,
				icon: jsx(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 14 }),
				onSelect: () => {
					setMenuOpen(false);
					openDialog(sessionId, displayTitle);
				},
				children: t("menu.delete")
			});
		}
		/** 框架级确认弹窗（常驻 shell.overlay，不随菜单卸载）。 */
		function DeleteSessionDialog({ useDeleteState, confirmDelete, cancelDelete, t }) {
			// 框架把 deleteState 快照源包成 useDeleteState(selector, equal?)
			const current = useDeleteState((value) => value);
			if (!current.open) return null;
			return jsx(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				title: t("dialog.title"),
				description: t("dialog.desc", { name: current.title || t("dialog.untitled") }),
				closeLabel: t("dialog.cancel"),
				onClose: () => {
					if (!current.busy) cancelDelete();
				},
				footer: jsxs(Fragment, { children: [jsx(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					disabled: current.busy,
					onClick: () => {
						if (!current.busy) cancelDelete();
					},
					children: t("dialog.cancel")
				}), jsx(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					className: "dsh-sd-danger",
					disabled: current.busy,
					onClick: () => {
						confirmDelete();
					},
					children: current.busy ? t("dialog.deleting") : t("dialog.confirm")
				})] }),
				children: current.error !== null ? jsx("p", {
					className: "dsh-sd-error",
					role: "alert",
					children: current.error
				}) : current.busy ? jsx("p", {
					className: "dsh-sd-status",
					role: "status",
					children: t("dialog.deleting")
				}) : null
			});
		}
		/** 父 fiber 的依赖：只声明自己真正用到的基础服务，不含本项目新建的命名空间。 */
		const inject = ["remote", "slots", "locale"];
		/** 确认后执行删除；成功后本地兜底摘掉列表行，再关闭弹窗。 */
		async function runDelete(ctx, t) {
			const sessionId = snapshot.sessionId;
			if (sessionId === "" || snapshot.busy) return;
			publish({ busy: true, error: null });
			try {
				const carried = await ctx.remote.sessionDelete.delete({ sessionId });
				if (!carried || carried.ok !== true) {
					publish({ busy: false, error: errorText(t, carried?.error?.code, carried?.error?.message) });
					return;
				}
				const result = carried.value;
				if (result && result.ok === false) {
					publish({ busy: false, error: errorText(t, result.error?.code, result.error?.message) });
					return;
				}
				// 宿主已广播 api-session/removed；这里是被动兜底：
				// 只有在列表里还能看到这一行时才手动摘一次（正常情况已经没了）。
				try {
					const list = ctx.sessions?.list?.getSnapshot?.();
					if (list && list.byId && list.byId[sessionId] !== void 0) {
						ctx.sessions.manager?.handleSessionRemoved?.(sessionId);
					}
				} catch {}
				closeConfirm();
			} catch (error) {
				publish({
					busy: false,
					error: errorText(t, "internal", error instanceof Error ? error.message : String(error))
				});
			}
		}
		/** 子 fiber 内注册 UI：此处 `ctx.remote.sessionDelete` 是合法的（已声明 inject）。 */
		function registerUi(ctx) {
			ensureStyle();
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "session-delete: dictionaries");
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "session-delete",
				locale: NS,
				inject: () => ({
					hooks: { deleteState },
					confirmDelete: () => {
						runDelete(ctx, t);
					},
					cancelDelete: closeConfirm
				})
			}, DeleteSessionDialog));
			ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
				name: "sidebar.workspaces.session.menu.item",
				id: "session-delete",
				order: 500,
				locale: NS,
				inject: () => ({
					openDialog: (sessionId, title) => openConfirm(sessionId, title)
				})
			}, DeleteSessionMenuItem));
		}
		/**
		* 挂载命名空间并接入 UI，返回同时撤销两者的 disposer。
		* @param ctx - 客户端 runtime（已 inject remote/slots/locale）。
		* @param contribution - sessionDelete 端点描述。
		* @returns 撤销 UI 与 Remote 的 disposer。
		*/
		async function mountSessionDelete(ctx, contribution) {
			const disposeRemote = await ctx.remote.$mount(contribution);
			const ui = ctx.inject(["remote.sessionDelete", "slots", "locale", "sessions"], registerUi);
			try {
				await ui;
			} catch (error) {
				await ui.dispose();
				await disposeRemote();
				throw error;
			}
			return async () => {
				await ui.dispose();
				await disposeRemote();
			};
		}
		async function apply(ctx) {
			return await mountSessionDelete(ctx, contribution);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
