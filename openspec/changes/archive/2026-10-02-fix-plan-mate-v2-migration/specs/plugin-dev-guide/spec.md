# Spec Delta

## ADDED Requirements

### Requirement: 标注 V1 版本基础并提供 v2 迁移指引

文章 SHALL 在开头明确标注其基于 opencode v1.18.x 的 V1 插件模型,定位为 V1 历史参考。文章 SHALL 包含一节 v2 迁移要点,说明 v2 插件模型的关键差异:`plugins` 配置与 `{package, options}` 对象替代 V1 `plugin` 数组元组、`Plugin.define({id, setup})` 导出替代 `PluginModule {id, server}`、domain API(如 `ctx.tool.transform`、`ctx.event.subscribe`、`ctx.session.hook`)替代 V1 hooks 对象、`ctx.session.hook("http.request"/"http.response")` 替代 fetch monkey-patch。V1 正文内容 SHALL 保持不变。

#### Scenario: 版本标注清晰

- **WHEN** 读者查看文章开头
- **THEN** 文章 SHALL 明确标注"本文基于 opencode v1.18.x(V1 插件模型),v2 插件模型已重写,本文仅作 V1 参考"

#### Scenario: v2 迁移章节存在且覆盖关键差异

- **WHEN** 读者查阅文章的 v2 迁移章节
- **THEN** 文章 SHALL 覆盖 v2 与 V1 的关键差异点:配置形态(plugins 对象 vs plugin 元组)、导出格式(Plugin.define vs PluginModule)、API 模型(domain API vs hooks 对象)、请求拦截方式(http.request/http.response 钩子 vs fetch monkey-patch)
- **AND** 文章 SHALL 指引读者查阅项目 docs 与官方 v2 迁移文档
