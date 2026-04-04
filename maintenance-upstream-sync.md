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
