# 上游同步记录

本文件用于持续记录本仓库与 `upstream/main` 的同步历史。

对应机制说明见：`maintenance-upstream-sync.md`

## 当前有效基线

- 当前记录时间：`2026-04-04`
- 当前本地分支：`main`
- 当前本地 HEAD：`未提交（同步前 HEAD 为 c5a94e5e679d782e03f0fe72305d29d23afc3a02）`
- 当前 upstream/main：`754b12694457ae563437c1179fc31ac33ce7d37b`
- 当前差异计数：`基于同步基线 c10f8ae2e222c7461fdf5500bf8be8e97fee7a9e：本地独立维护 4 提交，上游新增 79 提交；本次已完成补丁式同步并通过 go test ./...`
- 当前同步基线：`754b12694457ae563437c1179fc31ac33ce7d37b`
- 下次同步起点：`754b12694457ae563437c1179fc31ac33ce7d37b`

## 2026-04-04 同步记录

- 状态：`同步完成`
- 本地分支：`main`
- 同步前本地 HEAD：`c5a94e5e679d782e03f0fe72305d29d23afc3a02`
- 同步前 upstream/main：`754b12694457ae563437c1179fc31ac33ce7d37b`
- 差异计数：`按既有记录基线 c10f8ae2e222c7461fdf5500bf8be8e97fee7a9e 统计：本地新增 4 提交，上游新增 79 提交`
- 同步方式：`未直接 merge unrelated histories；基于 c10f8ae2e222c7461fdf5500bf8be8e97fee7a9e 生成 upstream 增量补丁，并使用 git apply --3way 同步到当前分支`
- 合并记录：`纳入 c10f8ae2e222c7461fdf5500bf8be8e97fee7a9e..754b12694457ae563437c1179fc31ac33ce7d37b 的上游更新，覆盖 v6.9.8 至 v6.9.13；重点包含 Codex/Responses websocket 修复、Gemini CLI endpoint 安全开关、Claude/Qwen/Antigravity executor 修复、模型清单更新与测试补强`
- 冲突处理：`共处理 6 个冲突文件：internal/api/middleware/response_writer.go、internal/api/middleware/response_writer_test.go、internal/config/sdk_config.go、internal/runtime/executor/codex_websockets_executor.go、internal/runtime/executor/helps/logging_helpers.go、internal/runtime/executor/helps/proxy_helpers.go；保留本地 Resin 与管理增强，同时吸收上游 SSE/WebSocket 修复与 Gemini CLI 安全配置；删除已不再适配 helps 拆包后的旧测试 internal/runtime/executor/logging_helpers_test.go`
- 同步后基线：`754b12694457ae563437c1179fc31ac33ce7d37b`
- 下次同步起点：`754b12694457ae563437c1179fc31ac33ce7d37b`
- 备注：`上游当前标签为 v6.9.13；同步完成后已执行 go test ./... 并通过`

## 2026-04-02 同步记录

- 状态：`基线建立`
- 本地分支：`main`
- 同步前本地 HEAD：`c10f8ae2e222c7461fdf5500bf8be8e97fee7a9e`
- 同步前 upstream/main：`c10f8ae2e222c7461fdf5500bf8be8e97fee7a9e`
- 差异计数：`0 0`
- 同步方式：`未执行合并；建立初始基线`
- 合并记录：`当前本地版本与 upstream/main 完全一致，从该提交开始记录后续同步`
- 冲突处理：`无`
- 同步后基线：`c10f8ae2e222c7461fdf5500bf8be8e97fee7a9e`
- 下次同步起点：`c10f8ae2e222c7461fdf5500bf8be8e97fee7a9e`
- 备注：`upstream/main 对应标签 v6.9.7，提交说明为 "Fixed: #2420"`
