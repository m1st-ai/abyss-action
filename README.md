# Abyss Action

GitHub ActionsからAbyssへAndroid（APK/AAB）・iOS（IPA）のリリース候補を登録する、顧客向けの公開JavaScript Actionです。Pull Request、commit SHA、バイナリSHA-256を一緒に登録します。解析は開始せず、Abyss上での明示承認を待ちます。

## 使い方

リポジトリをAbyssへ連携したうえで、ワークフローにOIDCトークン発行権限とActionのstepを追加します。APIキーやAbyss Application IDは不要です。

```yaml
name: Analyze mobile app

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  id-token: write

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
| `api-url` | No | `https://api.abyss.m1st.ai` | Abyssの公開APIベースURL。検証環境やセルフホスト環境を使う場合だけ指定します。 |
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
| `android-scan-id` | AndroidのGitHub Actions Scan ID。未指定時は空文字。 |
| `ios-scan-id` | iOSのGitHub Actions Scan ID。未指定時は空文字。 |

このActionはPull Requestイベント専用です。アップロード完了後、Abyss GitHub AppがPRへ解析開始リンクをコメントします。ユーザーがAbyss上でクレジット消費を確認すると解析とGitHub Check Runが開始されます。

## セキュリティ

- GitHub ActionsのOIDC JWTを各APIリクエストの直前に取得し、Abyss APIへBearer tokenとして送信します。永続的なsecretは使用しません。
- AbyssはJWTの署名、audience、repository ID、workflow、pull request ref、run IDを検証し、連携済みリポジトリに対応するApplicationを解決します。
- `id-token: write`はOIDC JWTの取得だけを許可します。Abyss側ではバイナリアップロード以外の権限を付与しません。

## リリース

利用側のワークフローを安定させるため、リリース時はSemVerタグ（例: `v1.0.0`）と追従するメジャータグ（例: `v1`）を作成してください。
