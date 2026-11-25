# 雅思学习工作台

在 Mac 上处理录音和保存练习，用「今天、题库、进步」三个页面准备 IELTS Academic。工作台把首次作答、同题重录、陌生题复测和完整限时模考分别记录。四科基线由实际作答建立，正式成绩按成绩单登记。

## 在 Mac 上打开

运行条件为 Node.js 24 或更高版本、本机 FFmpeg、FFprobe 与 Whisper.cpp。默认复用 `~/.cache/whisper/ggml-large-v3-turbo.bin`，可以用 `IELTS_WHISPER_MODEL` 指定本机路径。启动服务后访问 [本机工作台](http://127.0.0.1:4385/)。

```sh
npm start
```

Mac 登录后自动启动的安装命令。

```sh
npm run setup-mac
```

日常练习可以用 M4A、MP3 或 WAV 文件，最多 80 MB、16 分钟。原录音随记录保存，转写在 Mac 本地执行。打开录音时间戳可回听。短录音按原句纠错。发音与识别疑点由本人或教练听原声后确认，完整口语和写作模考可录入人工评阅。

## 启用本机文字点评

本机运行 Ollama 后，下载并核验模型，再开启自动点评。校验使用公开构造的正确句与含错句。所有建议都需原句证据，确认权由用户保留。

```sh
ollama pull qwen3:8b
IELTS_ENABLE_FEEDBACK=1 npm run check-feedback
npm run setup-mac -- --feedback
```

开发时也可用 `IELTS_ENABLE_FEEDBACK=1 npm start`。服务不可用时，录音、转写、回听和人工纠错仍可使用。软件所需的模型与命令行工具由各自维护者发布。

## 手机访问

1. 在 Mac 和手机安装 Tailscale，并用同一私人账户登录。按应用提示在设备上启用私人网络。
2. 在 Mac 运行下方命令。使用文字点评时带上 `--feedback`。如 Tailscale 提示启用 HTTPS 证书，先在其控制台确认设置，再运行一次。
3. 手机上打开命令返回的私有 HTTPS 地址。可以将网页添加到主屏幕。日常使用时 Mac 需要保持醒着且联网。

```sh
npm run setup-mac -- --remote --feedback
```

应用仍绑定本机回环地址。远程入口要求 Tailscale 注入的登录身份与 Mac 配置的本人账户一致。HTTPS 证书的设备域名可能出现在证书透明度日志。 [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) · [HTTPS 证书](https://tailscale.com/docs/how-to/set-up-https-certificates)

## 数据和恢复

默认数据目录在 `~/Library/Application Support/IELTS Workbench`。可用 `IELTS_DATA_DIR` 指定测试或恢复目录，使用 `IELTS_PORT` 调整本机端口。进步页可导出 Markdown。完整备份包含 SQLite 快照与录音原件及其播放文件，存为一个私有目录。

```sh
npm run backup -- create
npm run backup -- restore /path/to/backup /path/to/new-data-directory
```

恢复命令使用空目录或新目录。核对恢复内容后，可以用 `IELTS_DATA_DIR=/path/to/new-data-directory npm start` 先打开独立实例查看。关闭已有服务或另用端口启动。应用源码和题源索引的许可范围见 [LICENSE-SCOPE.md](LICENSE-SCOPE.md)。

## 验证

```sh
npm test
```

音频端到端测试使用 Whisper.cpp 安装包自带的公开片段。不同安装路径可用 `IELTS_TEST_PUBLIC_SAMPLE` 指定本地测试音频。测试库和样本输出写到临时目录。
