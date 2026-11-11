# dsh-session-delete

给 DeepSeek Harness 侧边栏会话行的「…」菜单补一个**「删除会话」**项。
官方只有「归档」（只是把会话 id 放进注册表隐藏，数据仍在磁盘），本项目提供真正的删除。

## 行为

- 菜单位置：会话行「…」→「归档会话」上方，红色 danger 样式。
- 确认方式：点击后菜单关闭，DSH 页面中央弹出**确认弹窗**（与官方「删除工作区」同一个
  `Modal` / `Button` 组件与配色），显示会话标题与「永久删除，无法恢复」的说明；
  「取消 / 删除」两个按钮，删除中按钮置灰。**不再是「再次点击确认删除」那种就地二次点击。**
- 执行内容：
  1. 拒绝删除**正在打开**的会话（先切到别的会话再删）；
  2. 从工作区注册表摘除（accounting / 归档集合 / 置顶集合）；
  3. `rm -rf ~/.dsh/sessions/<项目目录>/<sessionId>/` —— **永久删除，不进回收站**；
  4. 删除投影缓存 `~/.dsh/storages/session_projcache/sessions/<id>.json`
     （带 / 不带 `session-` 前缀两种历史键都删）；
  5. 补发官方 `api-session/removed` 事件，界面会话列表立刻移除该行
     —— 不会再出现「删完掉进未分组」的情况。

## 结构

| 文件 | 说明 |
| --- | --- |
| `index.js` | 宿主半：零 `@deepseek-ai` 依赖，`ctx.reflect.provide("sessionDelete")` + 手写 typert 绑定与 Remote 方法标记（方法**必须挂在原型上**，网关从原型链解析形参名）。删除后 `ctx.emit("api-session/removed", id)` 通知客户端。 |
| `client.js` | 客户端半：`ctx.remote.$mount()` 挂 `sessionDelete/delete` 端点；向 `sidebar.workspaces.session.menu.item` 注入菜单项，向常驻插槽 `shell.overlay` 注入确认弹窗（不随菜单卸载）。 |
| `cordis.patch.yml` | bundle patch：把本插件插入 profile 的插件树（没有它 `apply()` 不会执行）。 |
| `verify.mjs` | 旧版（0.2.0 契约）回归测试，仅作历史参考。 |

## 安装 / 更新

```bash
# profile 目录
cd ~/.dsh/profiles/desktop
# package.json: dependencies 加 "dsh-session-delete": "file:../../local-plugins/dsh-session-delete"
#               dsh.profile.bundles 加 "dsh-session-delete"
node "D:/Program Files/DSH-Desktop/resources/runtime/pnpm/bin/pnpm.cjs" install --config.node-linker=hoisted
```

注意：pnpm 对 `file:` 依赖**内容变更不重装**（会说 "Already up to date"），改完源码要手工同步：

```bash
rm -rf ~/.dsh/profiles/desktop/node_modules/dsh-session-delete
cp -r ~/.dsh/local-plugins/dsh-session-delete ~/.dsh/profiles/desktop/node_modules/
```

然后完全退出 DSH（含托盘）再启动。宿主半改动必须重启；客户端半改动刷新页面即可。

## 卸载

从 profile `package.json` 的 `dependencies` 与 `dsh.profile.bundles` 中删除本包，
删掉 `node_modules/dsh-session-delete`，重启 DSH 即可。

## 兼容性备忘

- 需要 DSH ≥ 0.1.7（`sidebar.workspaces.session.menu.item` 插槽在该版本引入）。
  0.2.2 起该插槽是 `contextMenu.content` 的兼容子插槽，props 仍是
  `{ sessionId, displayTitle }` + 注入的 `useMenuOpenState`。
- 0.2.0 起 typert strict codec 必须提供 `create()` 工厂（`schema` 字段会被拒，
  导致整个 web boot 失败）。
- `shell.overlay` 是框架级常驻插槽（官方配额提示、右键菜单都用它）；
  注册项 `inject()` 里的 `hooks: { deleteState }` 会映射成组件的 `useDeleteState` 属性。
- ⚠️ **`hooks` 里必须放「可订阅快照源」**（`getSnapshot()` + `subscribe(fn) → unsubscribe`），
  **不是 React Hook 函数**。渲染器 `bindInjectSources` 会把它包成
  `use<Name>(selector, equal?)`（同官方 `useNotice((cur) => cur)`）。
  传函数进去会在渲染时抛 `source.subscribe is not a function`，而渲染器的
  per-entry 隔离会**静默吞掉**这个错误 —— 现象就是「点了删除什么都不发生」，很容易误判成
  菜单没触发。快照对象只在变更时换新身份，`useSyncExternalStore` 才会重渲染。
