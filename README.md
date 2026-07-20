<div align="center">
  <img src="assets/icons/icon-128.png" width="96" height="96" alt="Wellcee 房源笔记图标">
  <h1>Wellcee 房源笔记</h1>
  <p>在浏览 Wellcee 时记录私人笔记、收藏房源并添加评分。</p>
  <p><strong>TypeScript 7 · lit-html · Rolldown · Chrome Manifest V3</strong></p>
</div>

## 为什么需要它

看房时，价格、位置和装修之外，往往还有许多只对自己有意义的信息：联系进度、通勤感受、优缺点，或下一次要问房东的问题。

这个扩展把这些信息放回房源页面旁边，并集中整理收藏、笔记和评分。所有数据默认只保存在当前 Chrome，不会写入 Wellcee，也不会发送到其他服务。

## Codex 房源筛选 Skill

仓库内置了可分发的 [`browse-wellcee-listings`](.agents/skills/browse-wellcee-listings/SKILL.md) Skill。它会让 Codex 使用用户现有的 Chrome 会话，按照自然语言条件筛选和比较 Wellcee 房源，并默认对最终入选房源添加笔记、收藏和评分。

在本仓库中使用 Codex 时可以直接调用：

```text
使用 $browse-wellcee-listings 帮我筛选上海 xxx 区月租 5,000 元以内的整租一居室，步行到地铁不超过 10 分钟，一个月内可入住且可养猫；优先采光好、装修较新、布局方正、有独立厨房和洗衣机的房源。
```

Skill 需要：

- Codex 的 Chrome 控制能力；
- 已在 Chrome 中加载本扩展；
- 可正常访问 Wellcee 的 Chrome 页面，无需登录。

如需单独分发，将整个 `.agents/skills/browse-wellcee-listings` 目录复制到目标仓库的 `.agents/skills/`，或复制到用户级 Codex skills 目录。

## 主要功能

| 场景 | 可以做什么 |
| --- | --- |
| 房源详情页 | 记录最多 2,000 字的私人笔记，内容自动保存；收藏房源，并为已收藏房源设置 1–5 星评分 |
| 房源列表页 | 直接收藏房源；在卡片上查看笔记摘要，悬停可展开完整内容 |
| 扩展弹窗 | 集中查看收藏和有笔记的房源，按时间或评分排序，并突出显示当前正在浏览的房源 |
| Chrome 侧边栏 | 浏览过程中持续打开完整房源列表，无需反复唤起弹窗 |
| 数据管理 | 将笔记、房源标题、收藏和评分导出为 JSON，或从备份文件合并导入 |
| 版本更新 | 打开弹窗或侧边栏时自动检查最新 GitHub Release，发现新版本后提供下载入口 |

扩展也会在再次打开房源详情时更新已保存的标题，并记住使用当前标签页还是新标签页打开房源的偏好。

## 安装

目前通过 GitHub Release 分发，并使用 Chrome 开发者模式安装：

1. 打开仓库的 [Releases](https://github.com/undermoonn/wellcee-apartment-notes/releases)，进入最新版本，在 **Assets** 中下载标记为 **Wellcee 房源笔记 Chrome 扩展安装包** 的 ZIP 附件。不要选择 GitHub 自动生成的 **Source code (zip)** 或 **Source code (tar.gz)**。
2. 解压下载的扩展包；压缩包内的根目录固定为不带版本号的 `wellcee-apartment-notes/`。
3. 在 Chrome 地址栏打开 `chrome://extensions`。
4. 开启右上角的「开发者模式」。
5. 点击「加载已解压的扩展程序」，选择解压后包含 `manifest.json` 的目录。
6. 刷新已经打开的 Wellcee 页面。

如需从源码构建，则克隆仓库后执行：

```bash
git clone https://github.com/undermoonn/wellcee-apartment-notes.git
cd wellcee-apartment-notes
pnpm install
pnpm build
```

然后在 Chrome 中选择生成的 `dist/`，不要选择项目根目录。

安装完成后，建议把扩展固定到 Chrome 工具栏，方便随时打开房源列表。

> 更新本地代码后，先运行构建生成新的 `dist/`，再在 `chrome://extensions` 中重新加载扩展并刷新 Wellcee 页面。

## 使用方式

### 记录笔记

打开形如 `https://www.wellcee.com/rent-apartment/<房源 ID>` 的详情页，在「我的房源笔记」中输入内容即可。扩展会在停止输入后自动保存；清空内容则会删除这条笔记。

返回房源列表后，有笔记的卡片会显示单行摘要。将鼠标移到摘要上可以展开查看完整内容。

### 收藏与评分

- 在列表页或详情页点击收藏图标，即可加入或移出收藏。
- 收藏房源后，可在详情页设置 1–5 星评分或清除评分。
- 取消收藏会同时删除该房源的评分，但不会删除笔记。
- 未收藏但有笔记的房源仍会保留在「有笔记」列表中，但不能评分。

### 管理房源

点击 Chrome 工具栏中的扩展图标，可以：

- 在「收藏」和「有笔记」两个列表之间切换；
- 按默认顺序或评分从高到低排列；
- 选择在当前标签页或新标签页打开房源；
- 打开常驻的 Chrome 侧边栏；
- 导出或导入本地数据。

默认排序下，收藏按收藏时间、笔记按更新时间从新到旧排列。

## 数据、备份与隐私

- 笔记、收藏、评分和打开方式偏好保存在 `chrome.storage.local`。
- 扩展只在 `wellcee.com` 和 `www.wellcee.com` 页面运行，不会把数据提交给 Wellcee 或其他服务。
- 扩展最多每 6 小时请求一次 GitHub 公开 Releases API 检查更新；请求不包含笔记、收藏或评分数据，检查结果缓存在本机。
- 清除扩展数据或卸载扩展会删除本地记录；如需保留，请提前导出 JSON 备份。
- 导入采用合并策略，不会先清空现有数据；相同房源 ID 的导入内容会覆盖现有内容。
- 备份文件最大支持 5 MB。导入时会校验房源 ID、Wellcee 链接、笔记长度和评分范围。

扩展申请的权限保持在完成核心功能所需的范围内：

| 权限 | 用途 |
| --- | --- |
| `storage` | 在当前 Chrome 中保存笔记、收藏、评分和设置 |
| `sidePanel` | 从扩展弹窗打开 Chrome 原生侧边栏 |
| `https://api.github.com/*` | 读取本项目最新的公开 GitHub Release 版本 |

## 本地开发

`dist/` 是本地生成且不会提交到仓库的构建产物。首次加载扩展或修改源码后，需要先安装依赖并重新构建：

```bash
pnpm install
```

安装依赖时会启用仓库内的 `.githooks/pre-commit`。每次提交前会依次运行 `pnpm typecheck` 和 `pnpm test`，任一检查失败都会阻止提交。

弹窗、侧边栏和注入 Wellcee 的控件都使用 TypeScript 7 与 `lit-html` 开发，并由 Rolldown 打包为 Manifest V3 可直接执行的 IIFE。构建会先清理 `dist/`，再生成包含清单、页面、样式、图标和脚本的独立扩展目录。不要直接编辑 `dist/` 中的文件：

```bash
pnpm build
```

只运行 TypeScript 严格类型检查：

```bash
pnpm typecheck
```

运行完整自动化检查需要 Node.js 20.19 或更高版本；检查会先完成类型检查并重新构建产物：

```bash
pnpm test
```

源码按职责拆分：`src/constants.ts`、`src/storage.ts` 和 `src/types.ts` 提供共享基础设施；`src/content.ts` 与 `popup/popup.ts` 是两个状态编排入口；对应的 lit-html 模板分别位于 `src/content-view.ts` 和 `popup/view.ts`；备份文件校验集中在 `popup/backup.ts`，版本检测集中在 `popup/update-check.ts`，Wellcee URL 与页面 DOM 解析集中在 `src/wellcee-page.ts`。

## 发布

类型检查与完整测试由本地 pre-commit hook 执行；GitHub Release 工作流仍会在正式发布前重新运行测试。发布版本时：

1. 将 `package.json` 和 `manifest.json` 的版本同时更新为相同的三段版本号，例如 `1.2.3`。
2. 确保版本提交已经合入并推送到 `main`。
3. 在该提交上创建并推送对应标签：

   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```

仅 `v<major>.<minor>.<patch>` 格式且指向 `main` 提交的标签可以发布。Release 工作流会重新测试项目、构建独立的 `dist/`、校验标签与两处版本号、生成 ZIP 和 SHA-256 校验文件，最后自动创建带生成式更新说明的 GitHub Release。ZIP 文件名保留发布版本，内部根目录固定为无版本号的 `wellcee-apartment-notes/`。

项目结构：

```text
.
├── manifest.json          # Chrome 扩展清单
├── LICENSE                # MIT 开源许可证
├── src/                   # 注入 Wellcee 页面的源代码与样式
├── popup/                 # 工具栏弹窗源代码与样式
├── sidepanel/             # Chrome 侧边栏
├── dist/                  # 可直接“加载已解压”的完整扩展分发目录
├── assets/icons/          # 扩展图标
├── .githooks/             # Git pre-commit 检查
├── scripts/               # 分发目录准备脚本
├── .github/workflows/     # GitHub Release 工作流
├── rolldown.config.ts     # 内容脚本与扩展页面的打包配置
├── tsconfig.json          # TypeScript 7 严格类型配置
└── test/                  # Node.js 自动化检查
```

## 常见问题

**页面上没有出现笔记或收藏控件？**

确认当前页面属于 `wellcee.com`，然后在 `chrome://extensions` 中重新加载扩展并刷新页面。扩展只识别 Wellcee 的房源列表页和数字 ID 详情页。

**重新安装后数据不见了？**

数据属于原扩展安装的本地存储。卸载扩展通常会一并删除这些数据，重新安装前请先从弹窗导出备份。

**Wellcee 页面更新后功能失效？**

扩展需要识别 Wellcee 的页面结构。若网站大幅调整 DOM，相关控件可能需要同步适配。

## 许可证

本项目采用 [MIT License](LICENSE)。你可以使用、修改和再分发代码，但需保留原始版权与许可声明。

## 图标与素材

扩展图标由 OpenAI 内置图像生成工具生成，源文件位于 `assets/icons/icon-source.png`，并提供 Chrome 所需的 16、32、48、128 像素版本。

页面内的笔记、收藏和评分图标使用 [Google Material Symbols](https://fonts.google.com/icons)，遵循其开源许可证。
