# Agentic Alias Inbox

Cloudflare の [agentic-inbox](https://github.com/cloudflare/agentic-inbox) をバックエンドにした、マスクメール生成用の Chrome 拡張機能です。
Web サイトのメールアドレス欄でボタンを押すと、`<ランダム10文字>@4zk.net` を生成し、agentic-inbox の API でメールボックスを作成してから欄に入力します。

agentic-inbox は、メールボックスが存在しないアドレス宛てのメールを破棄します。
そのため、この拡張機能はメールボックスの作成が成功するまでアドレスを入力しません。

## 動作

- メールアドレス欄（`type=email`、`autocomplete` に `email` を含む欄、または name、id、placeholder、aria-label に email、e-mail、メール を含むテキスト欄）にフォーカスすると、欄の右端に `@` ボタンが出ます。
- ボタンのメニューから「新しいアドレスを生成」を選ぶと、メールボックスを作成して欄に入力します。
  同じサイトで以前作成したアドレスもメニューに並び、選ぶとそのまま入力します。
- 入力欄の右クリックメニュー「マスクメールを生成して入力」でも同じ処理を実行します。
- 作成したアドレスは、サイト（先頭の `www.` を除いたホスト名）、ページ URL（クエリを除く）、作成日時とともに記録します。
  記録は設定画面で検索、メモの編集、コピー、削除ができます。
- メールボックスの表示名（返信時の差出人名）にはローカル部をそのまま使います。
  サイト名を表示名にすると、返信の差出人欄からどのサイト用のアドレスかが相手に伝わるためです。

生成したアドレスが既存のメールボックスと衝突した場合（409）は、別のアドレスで作り直します。
3 回続けて衝突した場合はエラーにします。

## インストール

1. Chrome で `chrome://extensions` を開きます。
2. 右上の「デベロッパー モード」を有効にします。
3. 「パッケージ化されていない拡張機能を読み込む」を押し、このリポジトリの `extension/` ディレクトリを選びます。
4. ツールバーの拡張機能アイコンを押すと設定画面が開きます。

## Cloudflare 側の設定

拡張機能は Cloudflare Access の Service Token で Worker の API を呼びます。
ブラウザでログインした Access のセッション Cookie は使いません。

### Service Token の作成

1. Cloudflare ダッシュボードで Zero Trust > Access > Service credentials > Service Tokens を開きます。
2. 「Create Service Token」を押し、名前（例 `agentic-alias-extension`）と有効期間（Service Token Duration）を選んで作成します。
3. 表示された Client ID と Client Secret を控えます。
   Client Secret はこの画面でしか表示されません。

### Access アプリケーションへのポリシー追加

1. Zero Trust > Access > Applications で、agentic-inbox の Worker を保護している既存のアプリケーションを開きます。
2. Policies に新しいポリシーを追加します。
   - Action：**Service Auth**
   - Include：Selector に「Service Token」を選び、上で作成したトークンを指定
3. 既存のブラウザログイン用の Allow ポリシーは残したまま保存します。

Action を Allow にすると、Access はトークンを受け付けてもログイン画面へリダイレクトします。
トークンだけで通すには Service Auth が必要です。

### 動作確認

次のコマンドで JSON が返れば、トークンとポリシーは正しく設定されています。

```sh
curl -sS https://<Worker のホスト>/api/v1/config \
  -H "CF-Access-Client-Id: <Client ID>" \
  -H "CF-Access-Client-Secret: <Client Secret>"
# => {"domains":["4zk.net"],"emailAddresses":[]}
```

302 やログイン画面の HTML が返る場合は、トークンまたはポリシーが一致していません。

### Worker の前提

- 環境変数 `DOMAINS` に `4zk.net` が含まれていること。
- 環境変数 `EMAIL_ADDRESSES` が空であること。
  値があると、そこに列挙されていないアドレスのメールボックス作成は 403 になります。
- Email Routing で `4zk.net` の catch-all を Worker に転送していること。

設定画面の「接続テスト」は `/api/v1/config` を呼び、前の 2 点を満たしていない場合に警告を表示します。

## 設定画面

| 項目 | 内容 |
| --- | --- |
| Worker URL | agentic-inbox の URL。`https://` のみ受け付け、パスは無視してオリジンだけを保存します。 |
| Client ID | Service Token の Client ID（`CF-Access-Client-Id`）。 |
| Client Secret | Service Token の Client Secret（`CF-Access-Client-Secret`）。 |
| ドメイン | アドレスのドメイン。既定値は `4zk.net`。先頭の `@` は除き、小文字にして保存します。 |

保存と接続テストのとき、Chrome が Worker のオリジンへのアクセス許可を求めます。
許可しないと保存しません。
接続テストは保存前のフォームの値で実行します。

## セキュリティ

- Client Secret は、この端末の `chrome.storage.local` に平文で保存されます。
  `chrome.storage.sync` は使わないので、Google アカウント経由で他の端末には同期されません。
- このトークンは、agentic-inbox のすべてのメールボックスを作成、閲覧、削除できます。
  Worker 側は Access の JWT の aud と issuer しか検証しないためです。
  Service Auth ポリシーはこのアプリケーションだけに付け、トークンの有効期間を短めにして定期的に作り直してください。
- コンテンツスクリプトはすべてのサイトで動きますが、Client Secret を受け取りません。
  API 呼び出しはすべて拡張機能のサービスワーカーが行い、ページにはアドレスだけを返します。
  記録の一覧、削除、メモ編集、接続テストのメッセージは、拡張機能のページから送られたものだけを受け付けます。
- API リクエストは `credentials: "omit"` で送ります。
  ブラウザに Access のログイン Cookie が残っていても、トークンが無効なら失敗として扱います。

## 制限

- 設定画面の「記録を削除」は、拡張機能の記録だけを消します。
  サーバー上のメールボックスは残り、引き続きメールを受信します。
  削除は agentic-inbox の Web UI から行ってください。
- 右クリックメニューから作成したとき、入力先のフレームにコンテンツスクリプトがない場合（Chrome Web Store など拡張機能が動かないページ）は入力できません。
  メールボックスは作成済みなので、設定画面の一覧からコピーしてください。
  このとき拡張機能アイコンに `!` が付きます。
- Worker の CORS 設定は localhost 以外のオリジンを許可しません。
  拡張機能はホスト権限で CORS を回避しているため、同じ API を Web ページから直接呼ぶことはできません。

## 開発

依存パッケージはありません。
Node.js 22 以降で動作を確認しています。

```sh
npm test      # 単体テスト（node --test）
npm run e2e   # 実際の Chrome に拡張機能を読み込み、ローカルの偽 Worker に対して操作を確認
```

`npm run e2e` は macOS の `/Applications/Google Chrome.app` と `openssl` を使います。
別の Chrome を使うときは環境変数 `CHROME` にバイナリのパスを指定します。
ヘッドレスでは権限ダイアログを操作できないため、一時コピーの manifest に偽 Worker のホスト権限を足してから読み込みます。

### 構成

| パス | 役割 |
| --- | --- |
| `extension/manifest.json` | MV3 マニフェスト |
| `extension/background.js` | サービスワーカー。メッセージハンドラ表、右クリックメニュー、API 呼び出し |
| `extension/content.js` | ページ内のボタン、メニュー、入力処理 |
| `extension/options.html`, `options.js`, `options.css` | 設定画面 |
| `extension/lib/generate.js` | ランダムなローカル部の生成（偏りのない棄却サンプリング） |
| `extension/lib/settings.js` | 設定値の検証と正規化 |
| `extension/lib/api.js` | agentic-inbox API クライアントとエラー分類 |
| `extension/lib/aliases.js` | 生成、作成、再試行、記録の一連の処理 |
| `extension/lib/store.js` | アドレス記録の保存 |
| `extension/lib/field.js` | メールアドレス欄の判定 |
| `extension/lib/site.js` | URL からサイトとページ URL を求める |
| `tests/` | 単体テストと E2E スクリプト |
