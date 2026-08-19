## 1. ProviderPool 重构 (src/pool.ts)

- [x] 1.1 将 `groups: Map<model, ProviderEntry[]>` 重构为 `byBaseURL: Map<string, ProviderEntry[]>`,构造函数按 `e.baseURL` 分组
- [x] 1.2 修改 `next()` 签名为 `next(model?: string, originBaseURL?: string)`:先取 `byBaseURL.get(originBaseURL)`,再按 `model` 过滤 `e.models.includes(model)`;退化链固定为同接入点池,不再使用扁平池
- [x] 1.3 移除 `hasGroup()`(仅测试引用)

## 2. fetch-patch 接线 (src/fetch-patch.ts)

- [x] 2.1 `patchFetch` 中调用 `pool.next()` 时传入已计算出的 `originalBaseURL`(第 50 行)

## 3. 测试更新

- [x] 3.1 更新 `tests/pool.test.ts`:新增同接入点分组用例(跨接入点不轮询、body 不可解析退化同接入点池、模型无匹配退化同接入点池),移除 `hasGroup` 断言
- [x] 3.2 更新 `tests/fetch-patch.test.ts`:验证请求从 ARK 端点发出时不会选中 native deepseek provider;同接入点下 URL 不变仅换 Authorization

## 4. 文档与规范

- [x] 4.1 同步 `openspec/specs/key-rotation/spec.md`(按 baseURL+model 分组、退化到同接入点池、跨接入点不轮询)
- [x] 4.2 更新 `README.md` 规则段("不按 baseURL 分组"改为"按 baseURL+model 分组,同接入点内轮询")

## 5. 验证

- [x] 5.1 运行 `bun test` 全绿
- [x] 5.2 运行 `bun x tsc --noEmit` 类型检查通过
- [x] 5.3 运行 `bun run build` 重新构建 `dist/index.js`
