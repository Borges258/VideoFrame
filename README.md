# VideoFrame

一个轻量级的 **视频帧处理 + 图片转换** 工具集，纯前端实现，无需后端服务或第三方依赖。视频解码、像素编辑、ZIP 打包、GIF 编码、图片格式互转全部在浏览器本地完成，文件不上传。

## 功能

### 一、MP4 视频帧处理器（`VideoFrame.html`）

1. **上传 MP4 → 提取 PNG 帧**
   - 拖拽或点击选择 MP4 视频
   - 可设置提取帧率（FPS）、输出分辨率（最长边像素）、最大帧数上限
   - 逐帧解码并输出为 PNG（保留原始画面）

2. **编辑 PNG 帧（像素级）**
   - 🖌️ 画笔：添加像素（自定义颜色、笔刷大小）
   - 🧽 橡皮：删除像素（变为透明）
   - 💧 取色器：从画面中拾取颜色
   - 缩放（适应 / 100% ~ 3200%），放大后显示像素网格
   - 撤销 / 重做 / 重置
   - 画布尺寸调整（9 种对齐方式，缩小裁切、放大以透明填充）
   - 复制 / 删除帧，方向键切换帧

3. **导出**
   - **ZIP**：将所有 PNG 打包为 ZIP（DEFLATE 压缩，保留透明与原始尺寸）
   - **GIF**：将帧合成为动画 GIF（可调帧延迟、循环次数、透明 / 白 / 黑背景）

### 二、图片格式互转（`convert.html`）

- 支持输入：JPG / JPEG / PNG / WebP / GIF / BMP / RAW（原始像素）
- 支持输出：**JPEG(.jpg) / PNG / WebP / RAW**
- JPEG / WebP 可调质量；JPEG 可选白 / 黑背景（填充透明区域）
- RAW 支持 RGBA / BGRA / RGB / BGR / 灰度 五种通道布局，可导入也可导出
- 多文件批量转换：单文件直接下载，多文件自动打包为 ZIP

### 三、主题

- **深色主题**（默认）
- **液态玻璃**：晶莹感磨砂玻璃质感，半透明面板 + 渐变光斑背景

主题在右上角下拉框切换，选择会通过 `localStorage` 记忆。

## 运行方式

本项目为纯静态站点，**零构建、零依赖**，任选其一：


## 浏览器要求

- Chrome / Edge / Firefox / Safari 等现代浏览器
- 视频解码依赖浏览器内置的 H.264 等编解码支持（MP4 通常可用）
- ZIP 压缩使用原生 `CompressionStream('deflate-raw')`，不支持时自动回退为无压缩存储

## 目录结构

```
VideoFrame/
├── VideoFrame.html     # 视频帧处理器入口
├── convert.html        # 图片转换入口
├── assets/
│   ├── style.css       # 基础主题样式
│   ├── theme-glass.css # 液态玻璃主题（叠加层，不修改基础样式）
│   ├── ui-addons.css   # 顶部导航 / 主题选择器样式
│   └── convert.css     # 图片转换页样式
├── js/
│   ├── utils.js        # 工具函数（CRC32、DEFLATE、Blob 转换等）
│   ├── extractor.js    # 视频 → PNG 帧提取
│   ├── editor.js       # 像素级帧编辑器
│   ├── zip.js          # 纯 JS ZIP 打包器
│   ├── gif.js          # 纯 JS GIF89a 编码器（median-cut + LZW）
│   ├── main.js         # 视频帧处理器编排（3 步流程）
│   ├── convert.js      # 图片格式互转
│   └── theme.js        # 主题切换管理
└── test/               # Node 单元测试（编码器往返验证）
    ├── lzw_test.js
    ├── gif_test.js
    ├── zip_test.js
    └── stream_test.js
```

## 测试

GIF 与 ZIP 编码器均使用零依赖的纯 JS 实现，并配有 Node 往返测试：

```bash
node test/lzw_test.js     # LZW 压缩往返（覆盖各种长度边界）
node test/gif_test.js     # GIF 完整结构解析 + LZW 解码验证
node test/zip_test.js     # ZIP 结构解析 + DEFLATE 解压验证
node test/stream_test.js  # GIF 流式编码路径
```

## 使用流程

**视频帧处理**

1. **步骤 1**：拖入 MP4，设置 FPS / 分辨率 / 最大帧数，点击「提取帧」。
2. **步骤 2**：点击下方缩略图选择帧，用画笔 / 橡皮 / 取色器编辑，或调整画布尺寸。
3. **步骤 3**：选择 ZIP 或 GIF，设置参数后下载。

**图片转换**

1. 拖入一张或多张图片（含 RAW）。
2. 若有 RAW 文件，填写其宽度、高度与通道布局。
3. 选择输出格式（JPEG / PNG / WebP / RAW）与质量等参数。
4. 点击「转换并下载」：单文件直接下载，多文件打包为 ZIP。
