# self-contained-build Specification

## Purpose

自包含构建与分发能力：保证 dist 构建产物在无插件运行时依赖下可被 opencode 正常加载，npm 发布包含预构建产物，类型依赖仅存于 devDependencies。

## Requirements

### Requirement: 构建产物自包含

插件 `dist/index.js` SHALL 内联 `@opencode-ai/plugin` 的 `tool()` 函数及其依赖(`zod`),运行时 SHALL NOT 要求 `node_modules` 中存在 `@opencode-ai/plugin`。

#### Scenario: 构建脚本不含 external 标志

- **WHEN** 执行 `bun run build`
- **THEN** `package.json` 中的 `build` 脚本为 `bun build src/index.ts --outdir dist --target node`(不含 `--external @opencode-ai/plugin`)
- **AND** `dist/index.js` 中包含 `tool` 函数的实现(非 `import` 外部模块)

#### Scenario: 无 node_modules 时插件正常加载

- **WHEN** `node_modules/@opencode-ai/plugin` 不存在
- **AND** opencode 通过 `import()` 加载 `dist/index.js`
- **THEN** 插件 SHALL 正常加载并注册 hooks
- **AND** `tool()` 函数 SHALL 返回传入的对象(恒等行为)

### Requirement: npm 包含预构建产物

发布到 npm 的包 SHALL 包含预构建的 `dist/index.js`,用户安装后无需执行构建步骤。`package.json` SHALL 包含 `"files": ["dist"]` 字段。

#### Scenario: 用户从 npm 安装后直接使用

- **WHEN** 用户在 `opencode.jsonc` 中声明 `"opencode-round-robin"`(包名形式)
- **AND** opencode 从 npm 缓存加载插件
- **THEN** 插件 SHALL 正常加载
- **AND** 用户 SHALL NOT 需要手动执行 `bun build` 或 `npm install @opencode-ai/plugin`

### Requirement: devDependencies 保留类型依赖

`@opencode-ai/plugin` SHALL 保留在 `package.json` 的 `devDependencies` 中,用于编译期类型检查;SHALL NOT 出现在 `dependencies` 中。

#### Scenario: 类型检查通过

- **WHEN** 执行 `tsc --noEmit`
- **THEN** 类型检查 SHALL 通过(`@opencode-ai/plugin` 类型从 `devDependencies` 解析)
