# Zorix CLI 中文说明

默认官网：

```text
https://zorix.it
```

该 CLI 通过 Zorix 官方登录接口获取会话 Cookie，验证登录状态，然后使用同一 Cookie 发送流式聊天请求。

## 安装

```bash
npm install -g ./zorix-cli-1.0.0.tgz
```

或者解压 ZIP 后：

```bash
npm install -g .
```

## 登录并获取 Cookie

```bash
zorix login
```

流程：

1. 请求 `/login?next=/chat`；
2. 提交账号密码到 `/api/zorix-auth-v802/login`；
3. 获取服务器返回的 `Set-Cookie`；
4. 请求 `/api/user/full-status` 验证登录；
5. 使用 AES-256-GCM 在本地加密保存 Cookie。

密码不会保存。

## Google 或浏览器登录

浏览器的 HttpOnly Cookie 不能被普通外部 CLI 自动读取。

```bash
zorix login --browser
zorix cookie import
```

也可以导入自己浏览器导出的 Netscape Cookie 文件：

```bash
zorix cookie import-file cookies.txt
```

只允许导入属于自己账号的 Cookie。

## 聊天

```bash
zorix chat "你好 Zorix"
```

交互模式：

```bash
zorix chat
```

文件和 stdin：

```bash
zorix chat --file prompt.txt
cat prompt.txt | zorix chat --stdin
```

JSON 输出：

```bash
zorix chat --json "返回 JSON"
```

## 模型

```bash
zorix models
zorix model use flash
zorix model use nex-plus
zorix model use nex26
zorix model use nex3
```

## 登录状态与配额

```bash
zorix status
zorix whoami
zorix quota
zorix doctor
zorix logout
```

## Cookie

```bash
zorix cookie list
zorix cookie import
zorix cookie import-file cookies.txt
zorix cookie clear
```

`cookie list` 只显示 Cookie 名称，不显示 Cookie 值。

## 历史记录

```bash
zorix history list
zorix history show ID
zorix history export history.json
zorix history clear
```

## 配置

```bash
zorix config list
zorix config get model
zorix config set model model-flash
zorix config set timeoutMs 90000
zorix config set thinking true
```

Linux 和 Termux 默认目录：

```text
~/.config/zorix-cli
```

## 多账号配置

```bash
zorix --profile personal login
zorix --profile work login
```

## 安全

- 不保存密码；
- Cookie 使用 AES-256-GCM 加密；
- 默认不输出 Cookie 内容；
- 不包含遥测；
- 默认只连接 `https://zorix.it`；
- 重定向不能跳转到其他域名；
- npm 包设为 `private`，避免意外发布。
