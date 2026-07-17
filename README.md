# Abyss Action

GitHub ActionsからAbyssへAndroid（APK/AAB）・iOS（IPA）のリリース候補を登録する、顧客向けの公開JavaScript Actionです。Pull Request、commit SHA、バイナリSHA-256を一緒に登録します。解析は開始せず、Abyss上での明示承認を待ちます。

## 使い方

リポジトリの `Settings > Secrets and variables > Actions` にAPIキーを `ABYSS_API_KEY` として登録し、ワークフローに次のstepを追加します。

```yaml
name: Analyze mobile app

on:
  workflow_dispatch:

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # この前にアプリをビルドするか、artifactをdownloadしてください。
      - name: Analyze with Abyss
        id: abyss
        uses: m1st-ai/abyss-action@v1
        with:
          api-key: ${{ secrets.ABYSS_API_KEY }}
          application-id: ${{ vars.ABYSS_APPLICATION_ID }}
          version-name: 1.4.0
          android: path/to/app-release.apk
          ios: path/to/app.ipa

      - name: Show upload keys
        run: |
          echo "Android: ${{ steps.abyss.outputs.android-key }}"
          echo "iOS: ${{ steps.abyss.outputs.ios-key }}"
```

`android` と `ios` はどちらか一方だけでも指定できます。両方を指定した場合は順番にアップロードされます。

## Inputs

| 名前 | 必須 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `api-key` | Yes | - | Abyss APIキー。必ずGitHub Actions secretから渡してください。 |
| `api-url` | No | `https://api.abyss.m1st.ai` | Abyssの公開APIベースURL。検証環境やセルフホスト環境を使う場合だけ指定します。 |
| `application-id` | Yes | - | Repositoryに紐付けたAbyss Application ID。 |
| `version-name` | No | - | PRコメントと確認画面に表示するリリースバージョン。 |
| `version-code` | No | - | 任意のビルド番号。 |
| `android` | 条件付き | - | APKまたはAABへのパス。`ios` とどちらか一方は必須です。 |
| `ios` | 条件付き | - | IPAへのパス。`android` とどちらか一方は必須です。 |

## Outputs

| 名前 | 説明 |
| --- | --- |
| `android` | Androidアップロード結果のJSON（`name`、`sizeBytes`、`fileCount`、`s3Key`）。未指定時は空文字。 |
| `ios` | iOSアップロード結果のJSON（`name`、`sizeBytes`、`fileCount`、`s3Key`）。未指定時は空文字。 |
| `android-key` | Androidバイナリの保存キー。未指定時は空文字。 |
| `ios-key` | iOSバイナリの保存キー。未指定時は空文字。 |
| `android-scan-id` | AndroidのCI Scan ID。未指定時は空文字。 |
| `ios-scan-id` | iOSのCI Scan ID。未指定時は空文字。 |

このActionはPull Requestイベント専用です。アップロード完了後、Abyss GitHub AppがPRへ解析開始リンクをコメントします。ユーザーがAbyss上でクレジット消費を確認すると解析とGitHub Check Runが開始されます。

## セキュリティ

- APIキーをワークフローへ直接記述せず、GitHub Actions secretから `api-key` に渡してください。
- APIキーはCLIと同じBearer tokenとしてAPIへ送信し、ログやコマンドライン引数には出力しません。
- forkから実行されるpull request workflowには通常secretが渡らないため、信頼できないコードへsecretを公開する設定は避けてください。

## リリース

利用側のワークフローを安定させるため、リリース時はSemVerタグ（例: `v1.0.0`）と追従するメジャータグ（例: `v1`）を作成してください。
