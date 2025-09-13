# SSHClient

## 简介

SSHClient 是一个基于 Electron 构建的远程 SSH 客户端，旨在提供一个现代化且易于使用的界面来管理和连接到您的远程服务器。

## 功能特性

*   **连接管理：** 轻松添加、编辑和删除您的 SSH 连接配置。
*   **标签式终端：** 支持多标签页终端，方便同时管理多个会话。
*   **现代化UI：** 采用 Ant Design 进行界面现代化，提供更美观和一致的用户体验。
*   **可调整侧边栏：** 侧边栏宽度可自由调整，以适应您的工作习惯。
*   **密码和私钥认证：** 支持使用密码或私钥文件进行 SSH 认证。

## UI现代化

本项目已将用户界面现代化，采用了 [Ant Design](https://ant.design/) 组件库，以提供更美观、更具交互性和一致性的用户体验。

## 安装与运行

### 1. 克隆仓库

```bash
git clone https://github.com/SuperUseryjh/onion-ssh.git
cd sshclient
```

### 2. 安装依赖

```bash
npm install
```

### 3. 运行开发版本

```bash
npm start
```

### 4. 打包可执行程序

```bash
npm run dist
```

打包完成后，可执行文件将在 `release` 目录下找到。

## SSH 连接问题

如果在连接 SSH 服务器时遇到问题（例如 "Connection lost before handshake"），请检查以下几点：

*   **网络连接：** 确保您的设备可以访问目标服务器。
*   **SSH 服务：** 确保目标服务器上的 SSH 服务正在运行。
*   **防火墙：** 检查服务器和本地设备的防火墙设置，确保 SSH 端口（默认为 22）是开放的。
*   **凭据：** 仔细检查您输入的用户名、密码或私钥路径是否正确。

## 许可证

本项目采用 [CC-BY-NC-SA 3.0 中国大陆](https://creativecommons.org/licenses/by-nc-sa/3.0/cn/deed.zh) 许可证。

## 贡献

欢迎贡献！如果您有任何改进建议或发现 Bug，请随时提交 Issue 或 Pull Request。
