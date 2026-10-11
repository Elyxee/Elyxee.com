# Elyxee · 定档完整版

2026-10-05 定档。**唯一网页入口是根目录 `index.html`**，包含 Home、Portfolio 的 Space / Dust，以及 About。`?preview=latest` 仍使用同一份文件，不是另一套版本。打开或刷新后，加载动画结束进入 Home。

## 本地查看

在项目目录运行：

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

打开 <http://127.0.0.1:4173/>。网址按界面显示为 `/`、`/portfolio`、`/about`；线上由 `wrangler.jsonc` 的 `single-page-application` 让这些路径都返回 `index.html`。本地这个简易服务器只能从 `/` 进入，直接打开 `/about` 会 404。任何路径刷新后都从 Home 开场开始。若已有服务在运行，直接使用原服务。无需构建、安装 npm 包或打开其他 HTML。

## 文件放在哪里

```text
index.html             唯一完整网页入口、导航和 favicon
styles.css             Home 的布局、字体和基础样式
components/
  site/                调度器（site.js）、界面表、地址栏、界面约定和两种火线转场
  burn/                Home 燃烧、恢复、文字与社交图标效果
  cursor/              Home 的火焰 / 冷态光标
  portrait/            Space / Dust、人像、画框、内容和场景切换
  about/               About 内容、布局和人物光照
Assets/                当前网页实际使用的图片、字体及字体许可
docs/                  接口说明、素材来源、定档记录
tests/                 按模块整理的必要回归检查，没有预览页面
scripts/               版本号生成、整站浏览器检查、图片导出和定档校验，不参与网页运行
wrangler.jsonc         现有 Cloudflare 静态站点配置
```

组件文件夹里的 `index.js` 是 JS 导出入口，不是另一个网站版本。运行中的素材和组件路径保留，避免整理引入视觉或加载变化。开发文档、测试和脚本已从静态资源发布范围排除；本次没有发布上线。

Favicon 从你指定的 `Assets/Elements/Favicon #1.PNG` 导出为 `Assets/optimized/favicon-64.png`，保留原图。`Assets/optimized/` 只放网页交付用的压缩素材；生成方式、原图对应关系及加载验证见 [loading.md](docs/loading.md)。

## 后续维护

- [架构与模块接口](docs/interfaces.md)：调度器、界面表和界面约定，以后怎么加一个新页面，配置位置，以及仍有的耦合。
- [定档与清理记录](docs/freeze.md)：本次改动范围、恢复点和验证结果。
- [Portrait 说明](docs/portrait.md)、[About 说明](docs/about.md)：各模块的实现约束。
- [人物素材来源](docs/image-provenance.md)、[转场材质来源](docs/transition-material.md)。

改完任何模块或样式后，重新生成版本号并运行测试（需要 Node.js）：

```sh
node scripts/stamp-versions.mjs
node --test tests/burn/*.test.mjs tests/portrait/*.test.mjs tests/site/*.test.mjs
```

再用真实浏览器走一遍所有进出方式（需要 Chrome；`--headed` 可观看，`--shots 目录` 保存截图）：

```sh
node scripts/check-site.mjs
```

定档文件对比仍可用 `node scripts/check-freeze.mjs`。

校验值变化只说明文件变了，不代替浏览器视觉检查。今后只有在新的效果经确认后，才更新定档基准；不要通过覆盖基准来隐藏未确认的变化。
