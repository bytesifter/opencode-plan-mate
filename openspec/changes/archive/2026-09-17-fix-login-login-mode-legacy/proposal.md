# fix-login-login-mode-legacy

## Why

登录脚本执行到逐账号登录时无限挂起:`arkcli auth login --no-browser` 在 arkcli v1.0.30 默认 `--login-mode auto` 下走新的 broker 链路——启动本地回调服务器(`callbackPort`)、打印纯文本 URL 后**阻塞等待浏览器回调**,且 stdout 不再是脚本所依赖的 `authorize_url` JSON。脚本的 `exec` 要等 phase1 退出才解析 URL、开浏览器,而 phase1 却等浏览器回调才退出 → 死锁;`cmd /c` 孙进程 arkcli 还握着 stdio 管道,`child.kill()` 杀不到孙进程,连 60s 超时都救不回来,永久卡死。

## What Changes

- `loginAccount` 的两次 `arkcli auth login`(phase1 无码、phase2 `--code`)都追加 `--login-mode legacy`,显式锁定旧跨设备链路:stdout 返回干净 JSON(`authorize_url`/`stage`/`next_command`)、exit 0,与脚本现有「解析 JSON → 开浏览器 → 贴码 → `--code` 完成」模型一致。
- 规格:`account-login-script` 的「浏览器 + 贴码交互登录」requirement 修改——登录子进程 SHALL 以 `--login-mode legacy` 执行,SHALL NOT 走默认 broker 链路(非交互管道下会阻塞本地回调而永不退出)。
- 无新依赖;不改插件运行时。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `account-login-script`:修改「浏览器 + 贴码交互登录」requirement——`auth login --no-browser` 子进程 SHALL 追加 `--login-mode legacy`(旧跨设备链路),使 stdout 返回含 `authorize_url` 的 JSON 并立即退出,SHALL NOT 使用默认 `auto` 模式(其 broker 链路在非交互管道下阻塞等待本地浏览器回调,导致脚本死等)。

## Impact

- `scripts/login-arkcli-accounts.ts`:`loginAccount` 内 phase1/phase2 的 `auth login` 参数。
- `tests/login-script.test.ts`:新增/调整用例断言 `auth login` 调用含 `--login-mode legacy`。
- 上游关联:`add-login-script-full-reset`(未归档)与 `fix-login-openurl-trusted-home` 均修改同一 requirement;归档顺序须保持本 change 最后。
- 无新依赖。
