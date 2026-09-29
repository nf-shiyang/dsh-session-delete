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
		* 2. 向侧边栏会话行「…」菜单插槽（sidebar.workspaces.session.menu.item）
		*    注入一个「删除会话」菜单项：第一次点击变为「再次点击确认删除」，再次点击执行。
		*
		* 结构对照官方同款（@deepseek-ai/dsh-experimental-client-ui-voice-input）：
		* 父 fiber 只 inject ["remote","slots","locale"] 并负责 $mount；命名空间
		* `remote.sessionDelete` 是本插件自己创建的，按 cordis 规则读它必须发生在
		* **声明了该 inject 的子 fiber** 内（ctx.inject），否则会抛
		* `cannot get property "remote.sessionDelete" without inject`。
		*/
		const NS = "session-delete";
		const zh = {
			"menu.delete": "删除会话",
			"menu.confirm": "再次点击确认删除",
			"error.open": "会话正在使用中，请先切换到其他会话再删除。",
			"error.notFound": "未找到该会话（可能已删除）。",
			"error.failed": "删除失败：{message}"
		};
		const en = {
			"menu.delete": "Delete session",
			"menu.confirm": "Click again to confirm",
			"error.open": "This session is open; switch to another session first.",
			"error.notFound": "Session not found (it may already be deleted).",
			"error.failed": "Delete failed: {message}"
		};
		/** 编解码：直传 JSON（宿主端自行校验）。
		* 0.2.0 起 strict codec 必须提供 create() 工厂（注册时校验），故不用 schema 字段。 */
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
		/** 报错文案 */
		function errorText(code, message) {
			if (code === "session-open") return zh["error.open"];
			if (code === "not-found") return zh["error.notFound"];
			return zh["error.failed"].replace("{message}", message || code || "unknown");
		}
		/** 「…」菜单中的删除项：两段式确认，danger 红色。 */
		function DeleteSessionMenuItem({ sessionId, useMenuOpenState, onDelete, t }) {
			const [, setMenuOpen] = useMenuOpenState();
			const [armed, setArmed] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (!armed) return;
				const timer = window.setTimeout(() => setArmed(false), 4000);
				return () => window.clearTimeout(timer);
			}, [armed]);
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MenuItemButton, {
				danger: true,
				icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 14 }),
				onSelect: () => {
					if (!armed) {
						setArmed(true);
						return;
					}
					setArmed(false);
					setMenuOpen(false);
					onDelete(sessionId);
				},
				children: t(armed ? "menu.confirm" : "menu.delete")
			});
		}
		/** 父 fiber 的依赖：只声明自己真正用到的基础服务，不含本项目新建的命名空间。 */
		const inject = ["remote", "slots", "locale"];
		/** 子 fiber 内注册 UI：此处 `ctx.remote.sessionDelete` 是合法的（已声明 inject）。 */
		function registerUi(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "session-delete: dictionaries");
			ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
				name: "sidebar.workspaces.session.menu.item",
				id: "session-delete",
				order: 500,
				locale: NS,
				inject: () => ({
					onDelete: async (sessionId) => {
						try {
							const carried = await ctx.remote.sessionDelete.delete({ sessionId });
							if (!carried.ok) {
								window.alert(errorText(carried.error?.code, carried.error?.message));
								return;
							}
							const result = carried.value;
							if (result && result.ok === false) {
								window.alert(errorText(result.error?.code, result.error?.message));
							}
						} catch (error) {
							window.alert(errorText("internal", error instanceof Error ? error.message : String(error)));
						}
					}
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
			const ui = ctx.inject(["remote.sessionDelete", "slots", "locale"], registerUi);
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
