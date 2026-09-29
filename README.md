# dsh-session-delete

给 DeepSeek Harness 侧边栏会话行的「…」菜单补一个**「删除会话」**项。
官方只有「归档」（只是把会话 id 放进注册表隐藏，数据仍在磁盘），本项目提供真正的删除。

## 从 GitHub 安装

DSH 只会加载 `~/.dsh/local-plugins/` 下的插件，所以把这个仓库克隆到那里即可：

```bash
git clone https://github.com/nf-shiyang/dsh-session-delete.git "$HOME/.dsh/local-plugins/dsh-session-delete"
```

然后把它挂进 desktop profile 的插件树（改 `~/.dsh/profiles/desktop/package.json`）：

```jsonc
{
  "dependencies": { "dsh-session-delete": "file:../../local-plugins/dsh-session-delete" },
  "dsh": { "profile": { "bundles": [ "…", "dsh-session-delete" ] } }
}
```

完全退出 DSH（含托盘）再启动，会话「…」菜单里就会出现「删除会话」。

## 行为

- 菜单位置：会话行「…」→ 归档会话下方，红色 danger 样式。
- 防误触：第一次点击变为「再次点击确认删除」，4 秒不操作自动复位。
- 执行内容：
  1. 拒绝删除**正在打开**的会话（先切到别的会话再删）；
  2. 从工作区注册表摘除（accounting / 归档集合 / 置顶集合）；
  3. `~/.dsh/sessions/<项目目录>/<sessionId>/` 整目录**移动**到
     `~/.dsh/trash/<时间戳>-<sessionId>/`（可手工搬回，不是不可逆删除）；
  4. 删除该会话的投影缓存 `~/.dsh/storages/session_projcache/sessions/<id>.json`。

## 结构

| 文件 | 说明 |
| --- | --- |
| `index.js` | 宿主半：零 `@deepseek-ai` 依赖，`ctx.reflect.provide("sessionDelete")` + 手写 typert 绑定与 Remote 方法标记（方法**必须挂在原型上**，网关从原型链解析形参名）。 |
| `client.js` | 客户端半：`ctx.remote.$mount()` 挂 `sessionDelete/delete` 端点 + `slots.inject("sidebar.workspaces.session.menu.item")` 注入菜单项。 |
| `cordis.patch.yml` | bundle patch：把本插件插入 profile 的插件树（没有它 `apply()` 不会执行）。 |
| `verify.mjs` | 回归测试：从**已安装的 DSH 0.2.0 代码**里抽出真实校验器（`validateInvocation` / `validateCodec` / `methodParameterNames`）来跑两端契约。 |

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

然后完全退出 DSH（含托盘）再启动。

## 验证

```bash
cd ~/.dsh/local-plugins/dsh-session-delete
node verify.mjs   # 需要先解包 app.asar 到脚本顶部 APP 指向的目录
```

## 卸载

从 profile `package.json` 的 `dependencies` 与 `dsh.profile.bundles` 中删除本包，
删掉 `node_modules/dsh-session-delete`，重启 DSH 即可。

## 兼容性备忘

- 需要 DSH ≥ 0.1.7（`sidebar.workspaces.session.menu.item` 插槽在该版本引入）。
- 0.2.0 起 typert strict codec 必须提供 `create()` 工厂（`schema` 字段会被拒，导致整个 web boot 失败）。
