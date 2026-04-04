# 上游同步机制说明

本文档用于规范本仓库与上游 `upstream` 的同步方式，以及如何记录每次同步的基线、合并记录和下一次同步起点。

该系列文档属于仓库维护记录，与 SDK 文档无关。

## 目标

建立一套可持续的上游同步机制，解决以下问题：

- 当前本地版本是否与上游一致
- 从哪个提交开始统计后续本地改动
- 每次同步时合并了哪些上游提交
- 冲突、取舍和人工修改发生在哪里
- 下一次同步应该从哪个基线开始

## 相关文件

- 机制说明：`maintenance-upstream-sync.md`
- 同步记录：`records-upstream-sync.md`

## 远程约定

当前仓库使用如下远程约定：

- `upstream`: `https://github.com/router-for-me/CLIProxyAPI`

后续同步一律以 `upstream/main` 为基准记录。

## 记录原则

每次准备同步、执行同步或完成同步后，都应更新 `records-upstream-sync.md`。

记录至少包含以下内容：

- 记录日期
- 本地分支
- 同步前本地提交
- 同步前上游提交
- 同步方式
- 合并结果
- 冲突处理说明
- 同步完成后的新基线
- 下一次同步起点

## 当前基线规则

当本地与上游完全一致时，应建立一条“基线记录”。

基线记录的作用是：

- 标记“从这里开始，本地进入独立维护阶段”
- 让后续所有自定义提交都能相对该基线追踪
- 为未来同步时的冲突分析提供固定起点

## 本仓库默认策略

本仓库已经确认存在“记录基线一致，但 Git 历史无共同祖先”的情况。

因此后续同步时，默认不要直接执行：

```bash
git merge --allow-unrelated-histories upstream/main
```

原因是这会把大量同路径文件识别为 `add/add` 冲突，机械冲突很多，处理成本高。

本仓库后续默认优先使用“基于记录基线的补丁式同步”：

1. 从 `records-upstream-sync.md` 读取 `下次同步起点`，记为 `<同步基线>`
2. 先分析 `git log` / `git diff --stat` 看上游改了什么
3. 用 `git diff --binary <同步基线>..upstream/main` 生成增量补丁
4. 先执行 `git apply --check --3way` 评估冲突
5. 再执行 `git apply --3way` 或 `git apply --3way --index` 正式同步
6. 只处理真正重叠的冲突文件

这样更接近“把上游自上次基线以来的增量应用到当前分支”，通常比直接 merge 更省事。

## 推荐同步流程

### 1. 同步前确认

执行以下检查：

```bash
git fetch upstream --prune
git status --short --branch
git rev-parse HEAD
git rev-parse upstream/main
git rev-list --left-right --count HEAD...upstream/main
```

确认点如下：

- 当前工作树是否干净
- 本地 `HEAD` 是哪个提交
- 上游 `upstream/main` 是哪个提交
- 本地领先/落后上游多少提交

### 2. 确认同步起点

从 `records-upstream-sync.md` 读取最近一条已完成记录中的：

- `同步后基线`
- `下次同步起点`

通常情况下，这两个值应与上一次完成同步后的本地基线一致。

### 3. 执行同步

按实际情况选择：

- `merge upstream/main`
- `rebase upstream/main`
- 当本地与上游没有共同祖先，但已有人工确认的同步基线时：
  `git diff --binary <同步基线>..upstream/main > /tmp/upstream-sync.patch`
  `git apply --3way /tmp/upstream-sync.patch`

若没有特别要求，建议优先使用 `merge`，因为：

- 历史更直观
- 更适合长期维护 fork
- 冲突点更容易从记录中追溯

但对本仓库当前形态，更推荐优先使用“补丁式同步”，因为它和已有记录基线机制更一致。

### 3.1 简化版流程

如果只是做一次常规上游同步，建议直接按下面顺序执行：

1. 从 `records-upstream-sync.md` 取出上次的 `下次同步起点`，记为 `<同步基线>`
2. 执行 `git fetch upstream --prune`
3. 执行 `git log --oneline <同步基线>..upstream/main | sed -n '1,80p'`
4. 执行 `git diff --stat <同步基线>..upstream/main`
5. 执行 `git diff --binary <同步基线>..upstream/main > /tmp/upstream-sync.patch`
6. 执行 `git apply --check --3way /tmp/upstream-sync.patch`
7. 若检查通过，再执行 `git apply --3way --index /tmp/upstream-sync.patch`
8. 处理冲突并 `git add` 已解决文件
9. 执行 `go test ./...`
10. 更新 `records-upstream-sync.md`
11. 提交同步结果

### 3.2 推荐命令模板

下面这组命令适合复制后稍作替换直接执行：

```bash
# 1) 填写上次记录中的“下次同步起点”
BASE=<同步基线>

# 2) 获取上游最新内容
git fetch upstream --prune

# 3) 先看这次上游到底改了什么
git log --oneline ${BASE}..upstream/main | sed -n '1,80p'
git diff --stat ${BASE}..upstream/main

# 4) 生成补丁并先做三方检查
git diff --binary ${BASE}..upstream/main > /tmp/upstream-sync.patch
git apply --check --3way /tmp/upstream-sync.patch

# 5) 正式应用
git apply --3way --index /tmp/upstream-sync.patch

# 6) 解决冲突后验证
git status --short
go test ./...
```

如果只想先看会不会冲突，不想立刻改工作树，那么只执行到 `git apply --check --3way` 即可。

### 3.3 如何判断哪些上游改动值得同步

为了减少不必要的人工合并，建议把上游改动分成“优先同步”和“可选同步”。

优先同步：

- 安全修复
- 鉴权流程修复
- 与上游 API 协议兼容性相关的改动
- websocket / SSE / 流式响应修复
- 模型列表与关键默认配置更新
- 能覆盖上述行为的测试修复

可选同步：

- 纯文案调整
- README 截图或展示位变化
- 仅重构命名、不影响当前 fork 行为的整理
- 当前分支未使用的目录或功能改动

如果某部分上游改动评估后“收益不大，但冲突很多”，可以明确记录为“本次未纳入”，不必强行同步。

### 3.4 提交建议

为了让后续追踪更清楚，建议至少拆成两个提交：

1. 代码同步提交
2. 记录更新提交

这样下次回看时，更容易区分“功能变化”和“维护记录变化”。

### 4. 处理冲突

冲突处理完成后，记录以下信息：

- 冲突文件
- 冲突原因
- 最终保留的是上游逻辑、本地逻辑，还是混合方案

### 5. 完成后更新记录

同步完成后立即更新 `records-upstream-sync.md`，写明：

- 本次同步纳入的上游范围
- 产生的合并提交或 rebase 后头提交
- 最终基线
- 下次同步起点

## 记录格式建议

每次同步记录统一使用以下结构：

```md
## YYYY-MM-DD 同步记录

- 状态：
- 本地分支：
- 同步前本地 HEAD：
- 同步前 upstream/main：
- 差异计数：
- 同步方式：
- 合并记录：
- 冲突处理：
- 同步后基线：
- 下次同步起点：
- 备注：
```

说明：

- `状态` 建议使用：`基线建立`、`同步完成`、`同步中止`
- `合并记录` 用于写本次实际纳入的上游提交范围或 merge/rebase 结果
- `下次同步起点` 通常填写本次 `同步后基线`

## 本仓库当前初始化基线

截至本次建立机制时，已确认：

- 本地 `HEAD`: `c10f8ae2e222c7461fdf5500bf8be8e97fee7a9e`
- `upstream/main`: `c10f8ae2e222c7461fdf5500bf8be8e97fee7a9e`
- 差异计数：`0 0`

因此从该提交开始，后续本地修改和上游同步将统一记录到 `records-upstream-sync.md`。
