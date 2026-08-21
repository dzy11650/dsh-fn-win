# DeepSeek Harness — Windows & 飞牛OS 发行工程

把官方 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（本地 AI 助手，Web UI 在 `127.0.0.1:3080`）打包成两种"双击即用"形态：

- **Windows**：Electron 托盘壳 + 内嵌独立 Node 24 + 完整 DSH 产物，spawn `dsh web` → 单文件 **portable exe**
- **飞牛OS**：Docker-in-FPK 应用包（`.fpk`），系统托管 compose，桌面图标一键打开，**镜像 tar 内嵌、离线自包含**

两者的 **80% 逻辑共用**：DSH 本体就是源码 `deepseek-harness-master/`，Win/飞牛只做"拉起 + 守护 + UI 入口"。

## 目录结构

```
# 注：官方 DSH 源码不进本仓库，由 CI 从 upstream 按 DSH_VERSION 克隆，保持仓库精简。
packages/
  shared-image/Dockerfile  # 多架构镜像：node:24 多阶段构建 DSH（飞牛用）
  win-electron/            # Electron 壳（main.js/preload.js/renderer）
    patches/apply-win-patch.cjs  # Windows 构建补丁（自动删 Linux-only 原生包）
fnos/                      # 飞牛 FPK 工程（fnpack create -t docker 结构）
  manifest                 # key=value！等号无空格
  cmd/main                 # 仅实现 status 探针；start/stop = exit 0（系统管 compose）
  cmd/install_callback     # 向导答案 → ${TRIM_PKGVAR}/.env，并 docker load 内嵌镜像
  config/{resource,privilege}
  wizard/install           # API Key / 端口 / 模式
  app/docker/docker-compose.yaml
  app/docker/dsh-harness.tar   # 由 CI 注入的多架构镜像（离线自包含）
  app/ui/config            # port 必须是字符串
.github/workflows/build.yml # 一次构建出 .fpk / 镜像 / .exe
```

## 关键约束（踩坑点）

1. **Node 版本**：DSH 要求 `^22.19.0 || >=24.0.0`。Electron 37 内置 Node 仅 22.16，**不够**，所以 Windows 版随包带独立 Node 24。Node 20 下 `pnpm install` 会失败（`node:util` 的 `styleText` 不存在）。
2. **`--no-open`**：启动 `dsh web` 必须加，否则 DSH 额外唤起系统浏览器。
3. **飞牛 manifest 是 `key=value`**，不是 JSON；`cmd/main` status 返回码 **0=运行 / 3=未运行**。
4. **飞牛 `app/ui/config` 的 `port` 是字符串**，`protocol` 写 `http`（DSH UI 明文，写 https 点图标打不开）。
5. **路径必须用 TRIM_* 变量**（`${TRIM_PKGVAR}` 等），不能写死，否则升级/卸载丢数据。
6. **镜像 tag 锁定**：DSH 开发者预览期、接口频繁破坏性变更，镜像基于具体 commit/版本，勿盲跟 master。
7. **沙箱降级**：Linux 容器内 landlock 可能不可用（`no-new-privileges` 已设），危险工具行为需真机验证。
8. **Windows 构建的本地限制**：上游 `pnpm-workspace` 把 Linux-only 原生包（landlock-run 的 arm64/x64 预编译）列为 workspace 成员，Windows 上 pnpm 链接阶段会 `UNKNOWN open` 中断。**解决方案**：`apply-win-patch.cjs` 在 `pnpm install` 前自动把 landlock 的 Linux 子包从 workspace 排除、并允许 `@esbuild/win32-x64` 构建。**此补丁只用于 Windows 构建**，飞牛 Linux 镜像保持完整上游配置（含 landlock）。
9. **本地 Windows 沙箱禁 symlink**：在受限环境（如某些 IDE 沙箱）里 pnpm 的符号链接无法遍历，导致 `dsh web` 无法本地构建。此情况下请使用下面的 **CI 构建**（GitHub Windows runner 支持 symlink，可正常出 exe）。

## 构建方式

### A. GitHub Actions（推荐，镜像加速）

推送 tag 或手动 `workflow_dispatch` 触发 `.github/workflows/build.yml`：

- `image` job：Linux 多架构（amd64+arm64）构建 `dsh-harness:0.1.0-rc.8` 并导出 tar
- `fnos` job：把 tar 塞进 `fnos/app/docker/dsh-harness.tar`，`fnpack build` 出 `.fpk`（无 fnpack 时退化为 tarball）
- `windows` job：应用 `apply-win-patch.cjs` → `pnpm install` → 把 DSH 产物 + Node24 拷进 `resources/` → electron-builder 出 **portable exe**

所有 npm/pnpm 走 `registry.npmmirror.com` 加速。产物在 Release / Artifacts 下载。

> `FNPACK_URL` 可设 secret 覆盖默认下载地址。

### B. 本地构建（需 symlink 能力，即普通 Windows + 开发者模式 / 或 WSL2 / Linux）

**飞牛**（需 Docker）：

```bash
# 1. 本地构建镜像并导出 tar
docker buildx build --platform linux/amd64,linux/arm64 \
  -f packages/shared-image/Dockerfile \
  -t dsh-harness:0.1.0-rc.8 --output type=docker,dest=dsh-harness.tar \
  deepseek-harness-master
# 2. 放入 fpk
mkdir -p fnos/app/docker && cp dsh-harness.tar fnos/app/docker/dsh-harness.tar
# 3. fnpack 需从飞牛开发者平台下载（Windows 是无后缀文件，改名 fnpack.exe）
fnpack build ./fnos
# 4. 真机测试（SSH 到 NAS）
appcenter-cli install-fpk dsh-fnOS.fpk
```

**Windows**：

```bash
cd deepseek-harness-master
node ../packages/win-electron/patches/apply-win-patch.cjs .
pnpm install --config.confirmModulesPurge=false
cd ../packages/win-electron
# resources/dsh 放 deepseek-harness-master 内容，resources/node 放 node.exe (24)
npm install
npm run dist:portable        # 单文件 portable exe
```

## 说明

- Windows 版走原生 Node 进程（非 Docker），对普通用户零门槛；飞牛走 Docker 天然跨 x86/ARM（`platform=all`），镜像内嵌离线自包含。
- 用户需自备 DeepSeek API Key（DSH 无免费额度），飞牛在向导填写、Windows 首次启动在设置页填写。
- 本地若想联调飞牛包，需自行安装 **Docker Desktop**（约 629MB），且 Windows 家庭版需 WSL2 后端。
