# 部署到 GitHub Pages

本项目是**纯静态站点**（零构建、零依赖），不需要任何 CI 编译步骤，部署非常简单。

- 仓库：<https://github.com/Borges258/VideoFrame>
- 部署后地址：**<https://borges258.github.io/VideoFrame/>**
- 入口文件：`index.html`（GitHub Pages 会自动把它作为站点首页）
- 图片转换页：`https://borges258.github.io/VideoFrame/convert.html`

> 前置条件：代码已推送到 GitHub，且仓库为 **Public**
> （免费账号的 Pages 只支持公开仓库；私有仓库需要 GitHub Pro）。

---

## 方式一：从分支部署（推荐，最简单）

不需要添加任何文件，只需在网页上点几下。

1. 打开仓库页面 → 顶部 **Settings**（设置）。
2. 左侧菜单 → **Pages**。
3. 在 **Build and deployment** 下：
   - **Source** 选择 `Deploy from a branch`
   - **Branch** 选择 `main`，目录选择 `/ (root)`
   - 点 **Save**
4. 等待约 1 分钟，刷新该页面，顶部会出现绿色提示：
   **Your site is live at https://borges258.github.io/VideoFrame/**
5. 打开该网址即可使用。

以后每次 `git push` 到 `main` 分支，站点会**自动重新部署**（通常 1 分钟内生效）。

---

## 方式二：用 GitHub Actions 部署（可选）

如果你更希望用 Actions 自动发布（例如以后想加构建步骤），可以改用这种方式。

### 第 1 步：添加工作流文件

在仓库中新建 `.github/workflows/pages.yml`：

```yaml
name: Deploy static site to Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - id: deployment
        uses: actions/deploy-pages@v4
```

### 第 2 步：切换 Pages 来源

1. 仓库 **Settings → Pages**。
2. **Source** 改为 `GitHub Actions`。
3. 提交并推送上面的工作流文件，Actions 会自动运行并发布。

> ⚠️ 两种方式**只能选一种**。如果 Source 选了 `GitHub Actions`，就不要再选分支部署；
> 反之，如果用分支部署，就不要添加这个工作流文件（否则每次 push 都会有一条失败记录）。

---

## 更新站点

站点内容就是仓库里的文件，所以**更新代码 = 更新网站**：

```bash
git add .
git commit -m "update"
git push origin main
```

推送后等待约 1 分钟，刷新网页即可看到最新版本（必要时按 `Ctrl+F5` 强制刷新缓存）。

---

## 已验证的部署兼容性

本项目在 GitHub Pages（项目子路径 `/<仓库名>/`）下可正常工作：

- ✅ 所有资源引用都是**相对路径**（`assets/...`、`js/...`），不依赖域名根路径。
- ✅ 已包含 `.nojekyll` 文件，跳过 Jekyll 处理，避免静态文件被忽略或改写。
- ✅ 所有处理都在浏览器本地完成，不需要服务器端能力；GitHub Pages 的纯静态托管完全够用。
- ✅ 站点使用 HTTPS，`CompressionStream` 等现代 Web API 可正常使用。
- ✅ 文件名全部为小写且大小写一致（Pages 运行在 Linux 上，**区分大小写**）。

---

## 常见问题

**Q：访问后显示 404？**
A：依次检查：
1. 仓库根目录是否有 `index.html`（必须叫这个名字，Pages 才会作为首页）。
2. **Settings → Pages** 里的分支是不是 `main`、目录是不是 `/ (root)`。
3. 刚开启 Pages 需要等 1~2 分钟，稍后再刷新。
4. 如果刚改过设置，可以到 **Actions** 标签页看部署进度。

**Q：页面能打开但是白屏 / 样式丢失？**
A：多半是路径或大小写问题。本项目已全部使用相对路径，若你手动改过文件名，请确认
`assets/`、`js/` 里的文件名与 HTML 中的引用**大小写完全一致**。

**Q：`test/` 文件夹会被公开吗？**
A：会。因为它就在仓库里，Pages 会把整个仓库当作站点内容。里面只有测试脚本，没有敏感信息，
所以无需处理。若你希望不公开，可改用「方式二 + 只上传需要的文件」，或把测试移到另一个仓库。

**Q：改了代码但网站没变化？**
A：浏览器缓存。按 `Ctrl+F5` 强制刷新；也可以开无痕窗口确认。

**Q：可以绑定自己的域名吗？**
A：可以。**Settings → Pages → Custom domain** 填入域名，然后到你的域名服务商添加一条
CNAME 记录指向 `borges258.github.io`，并勾选 **Enforce HTTPS**。同时建议在仓库根目录
添加一个内容为你的域名的 `CNAME` 文件。

**Q：`convert.html` 能直接访问吗？**
A：可以，地址是 `https://borges258.github.io/VideoFrame/convert.html`，
页面右上角的导航按钮也会互相跳转。
