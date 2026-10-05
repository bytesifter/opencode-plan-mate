---
name: and-release
version: 0.0.0
description: "【占位·未实现】发布能力（未来规划）。本 skill 尚未实现；被调用时[必须]立即停下并报告「and-release 尚未实现，属未来规划」，不执行任何动作。反触发：集成收口（走 and-integrate）、开发后验证（走 and-verify）、环境看管（走 and-local-governance）。"
metadata:
  requires:
    bins: []
---

# and-release 发布（占位 · 未实现）

本 skill 为**未来规划占位**，当前**未实现**。`[禁止]` 将其当作可用能力执行。

## 状态

- **未实现**。被调用时 `[必须]` 立即停下并报告「and-release 尚未实现，属未来规划」，`[禁止]` 执行任何动作（不改文件、不跑命令、不碰集群）。

## 未来职责（草案，非本次实现）

- master 的**发布**：版本号决策 / tag（`v<主>.<次>.<补>`）/ 发布物。与 `and-integrate` 的边界待该能力实现时定（本 change 将「发布动作」暂留 `and-integrate`，本 skill 未来只管版本 / tag）。

## 边界

- 不做集成收口（归 `and-integrate`）、不做开发后验证（归 `and-verify`）、不做环境看管（归 `and-local-governance`）。

**最后更新**：2026-10-05
**版本**：0.0.0（占位）
