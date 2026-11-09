# ProjectSync

ProjectSync 是 Windows 桌面同步工具，将本地项目目录与 WebDAV 双向同步。每个项目可单独设置包含、排除规则，也可跳过 Git 已跟踪的文件。其他设备可以发现远端项目并选择绑定。

## 使用

1. 在「WebDAV 节点」添加服务器并测试连接。
2. 添加或绑定项目，选择本地目录、远端目录和同步范围，再查看首次同步预览。
3. 在「冲突中心」选择保留方式。配置 OpenAI 兼容服务后，也可生成 AI 合并稿，审阅后确认写入。

AI 同步范围建议会发送相对路径和需求；AI 冲突合并会向配置的服务发送冲突文件文本。Git 排除按本机项目绑定保存。

## 从源码运行

准备 Windows、PowerShell 7、Node.js、pnpm 和 Rust MSVC 工具链。通过 Visual Studio Installer 安装「使用 C++ 的桌面开发」，包含 MSVC x64/x86 和 Windows SDK。启动和打包脚本会自动加载编译环境。运行：

```powershell
.\start.ps1
```

构建 NSIS 或 MSI 安装包可运行 `.\build-installer.ps1`。本地开发页面使用 `http://localhost:1421`；浏览器预览使用模拟数据，真实 WebDAV 同步在桌面应用中运行。

等同步结束并从系统托盘退出 ProjectSync，再在 PowerShell 7 中运行 `.\reinstall.ps1`。已安装的 MSI 由 Windows Installer 原位修复（不升级）；当前用户的 NSIS 使用本地已有安装包。脚本不会自动打包。可先加 `-WhatIf` 查看选中的操作。
