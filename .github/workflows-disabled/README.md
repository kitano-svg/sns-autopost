# 停止中のワークフロー（2026-11-06）

API利用料が発生しないよう、自動実行・手動実行とも停止しています。
このフォルダにあるファイルは GitHub Actions に認識されないため、実行されません。

## 再開するとき

1. 各ファイルを `.github/workflows/` に戻す（例: `git mv .github/workflows-disabled/queue-post.yml .github/workflows/`）。
2. 定期実行を戻す場合は、各ファイル内の `schedule:` のコメントを外す。
3. GitHub の Settings → Secrets and variables → Actions に必要なAPIキーがあるか確認する。
