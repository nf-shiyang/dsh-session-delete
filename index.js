/**
 * dsh-session-delete — 宿主半（Node / Cordis 插件）
 *
 * 在 Cordis 中注册名为 `sessionDelete` 的远程服务，供客户端半通过
 * Typert 网关调用（POST /api/sessionDelete/delete）。删除一个会话：
 *
 *   1. 仅拦截“真正打开中”的会话：依据 `workspace/session-activity` 瀑布流
 *      （与官方 archiveSession 同一判据），避免把已归档/已关闭会话误判为
 *      “使用中”而拒绝删除（旧版本用 sessions.get 判据，会误杀归档会话）；
 *   2. 从工作区注册表摘除：对存在的每个 workspace 实体 detach、从归档/置顶集合移除；
 *   3. 把 ~/.dsh/sessions/<项目目录>/<sessionId>/ 整目录移入
 *      ~/.dsh/trash/<时间戳>-<sessionId>/（不直接删除，可手工恢复）；
 *   4. 清掉 ~/.dsh/storages/session_projcache/sessions/<sessionId>.json 投影缓存。
 *
 * 零 @deepseek-ai 依赖：typert 绑定与 Remote 方法标记按
 * @deepseek-ai/dsh-typert-protocol 的运行时结构手工构造（网关只认
 * `service.typertRemote` 绑定 + 原型上的方法标记描述符），避免 profile 插件环境
 * 解析不到运行时包的问题。
 *
 * @module dsh-session-delete
 */

export const name = 'session-delete'

/** 依赖的宿主服务（运行期用 ctx.get 惰性解析，不在此硬依赖） */
export const inject = []

/** 会话 ID 形如 session-<uuid> */
const SESSION_ID_PATTERN = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** 与 @deepseek-ai/dsh-typert-protocol 的 REMOTE_METHOD_DESCRIPTOR 一致 */
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

import { join } from 'node:path'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'

/** 业务失败返回（与 message-feedback 等 typert 服务的返回惯例一致） */
function fail(code, message) {
  return { ok: false, error: { code, message } }
}

/**
 * 解析 DSH 主目录：与 @deepseek-ai/dsh-home-paths 的默认规则一致
 * （DSH_HOME 环境变量优先，其次 ~/.dsh）。
 */
function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv.trim()
  }
  return join(homedir(), '.dsh')
}

export function apply(ctx) {
  // 原型携带 Remote 方法标记（version 1，direct 调用）。
  // 网关（gateway/resolveSrcDescriptor → methodParameterNames）是从**原型链**上
  // 取方法描述符并解析形参名的，方法必须定义在原型上，不能挂在实例自身上。
  const proto = {}
  Object.defineProperty(proto, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze([
        Object.freeze({ method: 'delete', invocation: Object.freeze({ kind: 'direct' }) }),
      ]),
    }),
  })

  /**
   * 删除一个会话。请求：{ sessionId: string }
   * 返回业务结果 union：{ ok: true, value } | { ok: false, error }
   */
  proto.delete = async function (request) {
    try {
      const sessionId = request && typeof request.sessionId === 'string' ? request.sessionId : ''
      if (!SESSION_ID_PATTERN.test(sessionId)) {
        return fail('bad-request', `非法的会话 ID：${JSON.stringify(sessionId)}`)
      }

      // —— 1. 仅拦截“真正打开中”的会话 ——
      // 官方 archiveSession 用 `workspace/session-activity` 瀑布流判断活跃度，
      // 而非 sessions.get。sessions 服务对“已归档/已关闭但已知”的会话也会返回
      // 非 undefined，用 sessions.get 会把归档会话误判为“使用中”从而拒绝删除。
      try {
        const activity = await ctx.waterfall(
          'workspace/session-activity',
          { sessionId },
          () => Promise.resolve([]),
        )
        if (Array.isArray(activity) && activity.length > 0) {
          return fail('session-open', '该会话正在使用中，请先关闭/切换到其他会话再删除。')
        }
      } catch {
        // 拿不到活动信息时放行，不误杀（绝不能用 sessions.get 兜底拦截）
      }

      // —— 2. 工作区注册表摘除 ——
      const registry = ctx.get('workspaceRegistry')
      if (!registry) {
        return fail('unavailable', 'workspaceRegistry 服务不可用（DSH 版本不兼容？）。')
      }
      const known = await registry.sessionKnown(sessionId).catch((e) => {
        ctx.logger?.warn?.(`session-delete: sessionKnown 失败：${e?.message || e}`)
        return false
      })
      if (!known) {
        return fail('not-found', '未找到该会话（可能已删除）。')
      }

      // 从每个工作区实体摘除（没有工作区时 list() 返回空数组，自动跳过）
      for (const workspace of registry.list()) {
        try {
          await workspace.detachSession(sessionId)
        } catch (e) {
          ctx.logger?.warn?.(`session-delete: detachSession 失败：${e?.message || e}`)
        }
      }
      try {
        await registry.unarchiveSession(sessionId)
      } catch (e) {
        ctx.logger?.warn?.(`session-delete: unarchiveSession 失败：${e?.message || e}`)
      }
      try {
        await registry.unpinSession(sessionId)
      } catch (e) {
        ctx.logger?.warn?.(`session-delete: unpinSession 失败：${e?.message || e}`)
      }

      // —— 3. 会话文件移入回收站目录（不直接删除，可恢复） ——
      const home = dshHome()
      const sessionsRoot = join(home, 'sessions')
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const trashDir = join(home, 'trash', `${stamp}-${sessionId}`)
      const moved = []
      let groups = []
      try {
        groups = await readdir(sessionsRoot)
      } catch {
        // 会话根目录不存在：视为无文件可删
      }
      for (const group of groups) {
        const source = join(sessionsRoot, group, sessionId)
        try {
          const info = await stat(source)
          if (!info.isDirectory()) continue
          await mkdir(join(trashDir, group), { recursive: true })
          await rename(source, join(trashDir, group, sessionId))
          moved.push(source)
        } catch (e) {
          if (e && e.code !== 'ENOENT') {
            ctx.logger?.warn?.(`session-delete: 移动 ${source} 失败：${e?.message || e}`)
          }
        }
      }

      // —— 4. 投影缓存清理（小文件，直接删） ——
      const projectionCache = join(home, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
      await rm(projectionCache, { force: true }).catch(() => {})

      ctx.logger?.info?.(
        `session-delete: 会话 ${sessionId} 已摘除（${moved.length} 个数据目录移入回收站 ${trashDir}）。`,
      )
      return { ok: true, value: { deleted: true, moved } }
    } catch (e) {
      return fail('internal', e instanceof Error ? e.message : String(e))
    }
  }

  const service = Object.create(proto)

  // Typert 网关按此绑定发现服务（与 TypertRemoteService 构造函数等价）
  service.typertRemote = Object.freeze({
    service,
    serviceKey: 'sessionDelete',
    namespace: 'sessionDelete',
  })

  // 注册为 Cordis 服务（与 cordis Service 构造函数内部的 provide 等价）
  ctx.reflect.provide('sessionDelete', service)
}
