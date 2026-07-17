# Abyss Action

GitHub ActionsからAbyssへAndroid（APK/AAB）・iOS（IPA）のバイナリをアップロードし、解析を開始するJavaScript Actionです。Abyss CLIのアップロード・解析開始フローをActionとして利用できます。

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
          api-url: https://api.example.com
          application-id: your-application-id
          android: path/to/app-release.apk
          ios: path/to/app.ipa
          name: ${{ github.repository }} @ ${{ github.sha }}

      - name: Show analysis
        run: echo "Analysis ${{ steps.abyss.outputs.analysis-id }} finished with ${{ steps.abyss.outputs.status }}"
```

`android` と `ios` はどちらか一方だけでも指定できます。両方を指定した場合は同じ解析にまとめてアップロードされます。

## Inputs

| 名前 | 必須 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `api-key` | Yes | - | Abyss APIキー。必ずGitHub Actions secretから渡してください。 |
| `api-url` | Yes | - | Abyssの公開APIベースURL。 |
| `application-id` | Yes | - | 解析対象のApplication ID。 |
| `android` | 条件付き | - | APKまたはAABへのパス。`ios` とどちらか一方は必須です。 |
| `ios` | 条件付き | - | IPAへのパス。`android` とどちらか一方は必須です。 |
| `name` | No | `GitHub Actions analysis` | 解析の表示名。 |
| `wait` | No | `true` | 解析が終了状態になるまで待機します。 |
| `interval` | No | `10000` | 待機時のポーリング間隔（ミリ秒）。 |

## Outputs

| 名前 | 説明 |
| --- | --- |
| `analysis-id` | 作成された解析のID。 |
| `status` | Actionが最後に確認した解析ステータス。 |

`wait: true` の場合、解析結果が `failed` または `ai_failed` ならstepも失敗します。`partial` は解析結果を確認できるようstepを成功扱いにします。`wait: false` の場合は解析開始直後に終了し、`status` はその時点の値です。

## セキュリティ

- APIキーをワークフローへ直接記述せず、GitHub Actions secretから `api-key` に渡してください。
- APIキーはCLIと同じBearer tokenとしてAPIへ送信し、ログやコマンドライン引数には出力しません。
- forkから実行されるpull request workflowには通常secretが渡らないため、信頼できないコードへsecretを公開する設定は避けてください。

## リリース

利用側のワークフローを安定させるため、リリース時はSemVerタグ（例: `v1.0.0`）と追従するメジャータグ（例: `v1`）を作成してください。
