# 更新紀錄

本檔依 Keep a Changelog 格式維護，版本遵循 Semantic Versioning。

## [Unreleased]

### 新增

- 使用 Node 內建測試工具驗證 MCP 流程、設定載入、HTTP 逾時、取消與 stdio 啟動。
- 補齊安裝、啟動、測試與錯誤處理文件。

### 變更

- 每次 HTTP 請求設定 10 秒逾時，並傳遞 MCP 取消訊號。
- 英文城市直接查詢天氣，僅含漢字的城市進行翻譯，降低外部請求數。
- 設定載入獨立為 `config.js`，預設使用專案根目錄 `.env`，支援程序環境變數。
- 明確宣告 `zod` 依賴及 Node.js 18.19 最低版本，MCP Server 版本統一讀取 `package.json`。

### 修正

- 啟動即檢查金鑰；`npm start` 與 `npm run watch` 不再強制提供 `envPath`。
- 保留 `envPath` 路徑中的等號，明確指定檔案無法讀取時立即報錯。
- 在發送 HTTP 前拒絕空白城市，並去除有效城市的首尾空白。
- 翻譯失敗、空白或配額錯誤時保留原城市；取消翻譯後不再查詢天氣。
- 天氣查詢失敗統一回傳 MCP `isError: true`，提供 401、404 與逾時說明。
- 避免將 Axios 錯誤物件及其金鑰、請求設定輸出到日誌。
