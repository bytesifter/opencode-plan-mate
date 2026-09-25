# Spec Delta

## MODIFIED Requirements

### Requirement: 构建产物自包含

插件 `dist/index.js` SHALL 在 opencode v2 运行时下正常加载,运行时 SHALL NOT 要求 `node_modules` 中存在 `@opencode/plugin`(由 opencode 运行时提供,项目本地仅作为 `devDependencies` 类型依赖)。工具入参 SHALL 使用 JSON Schema 描述,构建产物 SHALL NOT 依赖 V1 的 `tool()` 函数内联或 `zod` 运行时。

#### Scenario: 构建脚本不含 external 标志

- **WHEN** 执行 `bun run build`
- **THEN** `package.json` 中的 `build` 脚本为 `bun build src/index.ts --outdir dist --target node`(不含 `--external @opencode/plugin`)
- **AND** `dist/index.js` 中不包含 `zod` 与 V1 `tool()` 的实现

#### Scenario: 无 node_modules 时插件正常加载

- **WHEN** 项目 `node_modules/@opencode/plugin` 不存在
- **AND** opencode v2 通过 `import()` 加载 `dist/index.js`
- **THEN** 插件 SHALL 正常加载并注册钩子与工具

### Requirement: npm 包含预构建产物

发布到 npm 的包 SHALL 包含预构建的 `dist/index.js`,用户安装后无需执行构建步骤。`package.json` SHALL 包含 `"files": ["dist"]` 字段。

#### Scenario: 用户从 npm 安装后直接使用

- **WHEN** 用户在 `opencode.jsonc` 的 `plugins` 数组中声明 `"opencode-plan-mate"`(包名形式)
- **AND** opencode v2 从 npm 缓存加载插件
- **THEN** 插件 SHALL 正常加载
- **AND** 用户 SHALL NOT 需要手动执行 `bun build` 或安装运行时插件包

### Requirement: devDependencies 保留类型依赖

`@opencode/plugin` SHALL 保留在 `package.json` 的 `devDependencies` 中,用于编译期类型检查;SHALL NOT 出现在 `dependencies` 中。

#### Scenario: 类型检查通过

- **WHEN** 执行 `tsc --noEmit`
- **THEN** 类型检查 SHALL 通过(`@opencode/plugin` 类型从 `devDependencies` 解析)
