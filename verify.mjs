/**
 * 回归测试（对照 DSH 0.2.0 安装包内的真实代码 / 真实运行规则）：
 *
 *  1. 客户端 codec 契约 → 抽真实 validateInvocation/validateCodec/validateSegment 跑校验；
 *  2. 客户端 inject 规则 → 用模拟 cordis 上下文复现
 *     `cannot get property "remote.sessionDelete" without inject` 守卫，
 *     断言父 fiber 直接取命名空间会抛、子 fiber（ctx.inject）内才能调用；
 *  3. 宿主半 → 抽真实 methodParameterNames，确认网关能从原型链找到 delete 并解析形参。
 *
 * 运行：node verify.mjs
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const APP = "C:/Users/ZHANG/AppData/Local/Temp/dsh-check/asar-extract/dsh/node_modules/@deepseek-ai";
const REGISTRY = `${APP}/dsh-typert-registry/lib/client.js`;
const GATEWAY_HOST = `${APP}/dsh-api-gateway/lib/index.js`;

function sliceFrom(file, startMarker, endMarker) {
  const src = readFileSync(file, "utf8");
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error(`${file}: 未找到 ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${file}: 未找到 ${endMarker}`);
  return src.slice(start, end);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/* ────────────── 1. 载入真实校验器 ────────────── */
const registrySandbox = {};
vm.createContext(registrySandbox);
vm.runInContext([
  sliceFrom(REGISTRY, "function validateInvocation(descriptor) {", "//#endregion"),
  sliceFrom(REGISTRY, "function validateCodec(codec, subject) {", "//#endregion"),
  sliceFrom(REGISTRY, "function validateSegment(subject, value) {", "//#endregion"),
  sliceFrom(REGISTRY, "function validateNonempty(subject, value) {", "//#endregion"),
].join("\n"), registrySandbox);
console.log("✓ 载入 0.2.0 真实校验器（validateInvocation / validateCodec / validateSegment）");

/* ────────────── 2. 模拟 cordis 客户端上下文（含 inject 守卫） ────────────── */
let clientFactory;
globalThis.window = {
  __ModuleLoader__: { load: (record) => { clientFactory = record.factory; } },
  alert: (message) => { console.log(`  [alert] ${message}`); },
  setTimeout: () => 0,
  clearTimeout: () => {},
};
vm.runInThisContext(readFileSync(new URL("./client.js", import.meta.url), "utf8"), { filename: "client.js" });
const client = clientFactory((id) => id.startsWith("react") ? {} : {});
assert(typeof client.apply === "function" && Array.isArray(client.inject), "客户端半导出契约不符（应有 apply/inject）");

const mounted = [];
const namespaces = new Set();
const registrations = [];

/** 造一个带 inject 守卫的 ctx：只有 deps 里声明了 remote.<ns> 才允许取该属性。 */
function makeCtx(deps, options = {}) {
  const ctx = {
    effect: (fn) => { fn(); return () => {}; },
    locale: { register: () => () => {} },
    slots: {
      inject: (name, factory) => { factory(); },
      register: (config, component) => { registrations.push({ config, component, ctx }); return () => {}; },
    },
    inject: (childDeps, callback) => {
      const scope = makeCtx(childDeps);
      const fiber = (async () => { callback(scope); })();
      fiber.dispose = async () => {};
      return fiber;
    },
  };
  const remote = {
    $mount: async (contribution) => {
      mounted.push(contribution);
      for (const descriptor of contribution.descriptors) namespaces.add(descriptor.namespace);
      return async () => {};
    },
  };
  // 命名空间属性访问守卫：未被 inject 声明时抛错（复刻 cordis ReflectService.handler 的行为）
  ctx.remote = new Proxy(remote, {
    get: (target, prop, receiver) => {
      if (typeof prop === "symbol" || prop.startsWith("$")) return Reflect.get(target, prop, receiver);
      if (!namespaces.has(prop)) return undefined;
      if (!deps.includes(`remote.${prop}`)) {
        throw new Error(`cannot get property "remote.${prop}" without inject`);
      }
      return { delete: async (request) => { options.onCall?.(request); return { ok: true, value: { deleted: true, moved: [] } }; } };
    },
  });
  return ctx;
}

const parentCtx = makeCtx(client.inject, { onCall: (request) => console.log(`  [host] sessionDelete/delete ← ${JSON.stringify(request)}`) });
await client.apply(parentCtx);

/* ── 2a. 反例：父 fiber 直接取命名空间必须被守卫拒绝 ── */
let guardFired = false;
try { parentCtx.remote.sessionDelete; } catch (error) { guardFired = /without inject/.test(error.message); }
assert(guardFired, "守卫未生效：说明测试桩没有复刻 cordis 的 inject 检查");
console.log("✓ 反例对照：父 fiber 直接取 ctx.remote.sessionDelete 被守卫拒绝（原报错即此）");

/* ── 2b. 正例：子 fiber 内注册成功，且调用链可用 ── */
assert(mounted.length === 1, `期望挂载 1 个 contribution，实际 ${mounted.length}`);
registrySandbox.validateSegment("Remote package name", mounted[0].package);
for (const descriptor of mounted[0].descriptors) registrySandbox.validateInvocation(descriptor);
console.log(`✓ 客户端 contribution 通过真实校验：${mounted[0].descriptors.map((d) => `${d.namespace}/${d.method}`).join(", ")}`);

assert(registrations.length === 1, `期望注册 1 个菜单项，实际 ${registrations.length}`);
const { config, ctx: uiCtx } = registrations[0];
assert(config.name === "sidebar.workspaces.session.menu.item" && config.id === "session-delete" && config.order === 500, `菜单项注册参数异常：${JSON.stringify({ name: config.name, id: config.id, order: config.order })}`);
console.log(`✓ 菜单项注册：${config.name} / id=${config.id} / order=${config.order} / locale=${config.locale}`);

const injected = config.inject();
assert(typeof injected.onDelete === "function", "菜单项未注入 onDelete");
await uiCtx.remote.sessionDelete.delete({ sessionId: "session-11111111-1111-1111-1111-111111111111" }); // 直接经命名空间调用
await injected.onDelete("session-22222222-2222-2222-2222-222222222222"); // 组件走的真实路径
console.log("✓ 子 fiber 内的调用链走通（命名空间可访问、onDelete 可用）");

/* ────────────── 3. 宿主半：真实网关解析 ────────────── */
const gatewaySandbox = {
  TypertGatewayError: class TypertGatewayError extends Error {
    constructor(code, endpoint, message) { super(message); this.code = code; this.endpoint = endpoint; }
  },
};
vm.createContext(gatewaySandbox);
vm.runInContext([
  sliceFrom(GATEWAY_HOST, "function methodParameterNames(service, method, endpoint) {", "\nfunction assertExactArguments"),
  sliceFrom(GATEWAY_HOST, "function invalidSignature(endpoint, method) {", "\nfunction assertExactArguments"),
].join("\n"), gatewaySandbox);

const provided = {};
const hostCtx = {
  reflect: { provide: (name, value) => { provided[name] = value; } },
  get: (name) => provided[name] ?? null,
  logger: { info: () => {}, warn: () => {} },
};
const { apply: hostApply } = await import(new URL("./index.js", import.meta.url));
hostApply(hostCtx);
const service = hostCtx.get("sessionDelete");
assert(service, "宿主半未注册 sessionDelete 服务");
const binding = Reflect.get(service, "typertRemote");
assert(binding && binding.service === service && binding.serviceKey === "sessionDelete" && binding.namespace === "sessionDelete", "typertRemote 绑定不一致");
const names = gatewaySandbox.methodParameterNames(service, "delete", "sessionDelete/delete");
assert(JSON.stringify(names) === '["request"]', `形参解析结果异常：${JSON.stringify(names)}`);
console.log(`✓ 宿主半通过真实网关解析：原型上有 delete，形参 ${JSON.stringify(names)} → 线上字段 "request"`);

const marker = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(service), "@deepseek-ai/dsh-typert-protocol/remote-methods")?.value;
assert(marker?.version === 1 && marker.methods?.[0]?.method === "delete", "Remote 方法标记缺失");
console.log("✓ Remote 方法标记（version 1 / direct）就位");

const bad = await service.delete({ sessionId: "xxx" });
assert(bad.ok === false && bad.error.code === "bad-request", `非法 ID 守卫异常：${JSON.stringify(bad)}`);
const missing = await service.delete({ sessionId: "session-00000000-0000-0000-0000-000000000000" });
assert(missing.ok === false, `未知会话应失败：${JSON.stringify(missing)}`);
console.log(`✓ 业务守卫：非法 ID → ${bad.error.code}；未知会话 → ${missing.error.code}`);

console.log("VERIFY-OK");
