## Context

当前 `ProviderPool` 按 model 构建分组(`Map<model, ProviderEntry[]>`),`next(model)` 从该分组随机选。fetch-patch 已在请求进入轮询路径前计算出 `originalBaseURL`(`findBaseURL`,见 `fetch-patch.ts:45`),可直接复用为"接入点"标识。见 proposal.md - Why 了解动机。

## Goals / Non-Goals

**Goals:**

- 轮询仅发生在同接入点(baseURL)内:请求从哪个端点发出,就在该端点下的 provider 中随机轮
- 保持最小改动:不新增配置项、不引入跨接入点兜底
- 保留现有 cooldown / stats / 日志机制不变

**Non-Goals:**

- 不做跨厂商 failover(某接入点全熔断时 passthrough,与现状一致)
- 不按 npm adapter 分组(同接入点天然同厂商同协议,无需额外维度)
- 不重构 stats 数据模型或日志格式

## Decisions

### 决策 1: 用 `byBaseURL` 单 Map + 可选 model 过滤,替代双 Map

**选择**: 构造函数只构建 `Map<baseURL, ProviderEntry[]>`,`next()` 先取 `byBaseURL.get(originBaseURL)`,再按 `model` 过滤 `e.models.includes(model)`。不再维护 `Map<model, ...>` 或 `${baseURL}|${model}` 拼接键。

```ts
next(model?: string, originBaseURL?: string): ProviderEntry | null {
  const basePool = originBaseURL ? this.byBaseURL.get(originBaseURL) : this.entries
  if (!basePool || basePool.length === 0) return null
  let pool = basePool
  if (model) {
    const filtered = basePool.filter((e) => e.models.includes(model))
    if (filtered.length > 0) pool = filtered
  }
  const available = pool.filter((e) => !this.isCoolingDown(e.key, now))
  if (available.length === 0) return null
  return available[random]
}
```

注意:仅当按 model 过滤结果非空时才使用过滤后的分组;过滤结果为空(该接入点无 provider 支持该 model)时退化到同接入点池,匹配 spec"模型无对应 provider 时退化到同接入点池"。若 model 分组非空但全部熔断,则返回 null(passthrough),不退化到非匹配 provider,匹配"分组内全部熔断时 passthrough"。

**理由**: 避免字符串拼接 key 的边界风险(baseURL 含分隔符),逻辑比双 Map 更直白;`findBaseURL` 返回的就是配置里的原始 baseURL 字符串,与 `byBaseURL` 的键天然一致。

**替代方案**: `Map<baseURL, Map<model, ...>>` 嵌套结构。否决——嵌套 Map 遍历和构建更繁琐,单 Map + 过滤足够(provider 数量是 O(几十) 量级)。

### 决策 2: `next()` 增加 `originBaseURL` 参数,退化链固定为"同接入点池"

**选择**: fetch-patch 调用 `pool.next(model, originalBaseURL)`。选择顺序:

1. `(originBaseURL, model)` 分组 → 组内随机
2. model 不可解析/无匹配 → `byBaseURL.get(originBaseURL)` 同接入点池随机
3. 分组全熔断 → 返回 null → passthrough

**理由**: 请求能进入轮询路径必然已匹配某 baseURL(否则 passthrough),所以 `originBaseURL` 恒有值;退化链不再触碰其他接入点,杜绝跨厂商混轮。

**替代方案**: 保留扁平池作为最终兜底。否决——这正是当前跨厂商混轮的根源。

### 决策 3: 同接入点下 URL 替换语义不变

**选择**: 保留 `path = url.slice(originalBaseURL.length)` + `newUrl = entry.baseURL + path` 逻辑。同接入点下 `entry.baseURL === originalBaseURL`,新 URL 与原 URL 相同,实际效果仅换 Authorization 头。代码无需特判。

**理由**: 逻辑天然正确,零额外代码。跨接入点场景已不存在,不存在 URL 拼接错配的可能。

### 决策 4: 移除/收敛 `hasGroup()`

**选择**: `hasGroup()` 仅被测试引用(`tests/pool.test.ts:120-122`),生产代码无调用。随 `next()` 语义改为"按接入点",该 API 失去意义,同步移除并在测试中删除对应断言。

**理由**: 死代码清理,避免测试锁住过时语义。

## Risks / Trade-offs

- **[单 provider 接入点退化为无操作]** 某接入点只有 1 个 provider 时,`next()` 必然选中它,等价 passthrough。 → 无实际影响,可接受。
- **[跨接入点兜底能力丢失]** 同 model 在某接入点全熔断时,不再自动切到其他接入点(旧行为可跨厂商)。 → 用户明确接受;passthrough 回退到 opencode 原生请求,行为与"未安装插件"一致。
- **[originBaseURL 字符串精确匹配]** 若不同 provider 的 baseURL 字符串存在尾斜杠等细微差异,`findBaseURL` 与 `byBaseURL` 键可能不一致。 → 保持现状约定(配置中 baseURL 需逐字符一致),不新增规范化逻辑,避免过度设计。
