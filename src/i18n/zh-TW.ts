const zhTW: Record<string, string> = {
    // auth
    "auth.telegramRequired": "Telegram 登入驗證已開啟，請先完成驗證碼登入",
    "auth.unauthorized": "Unauthorized",

    // system
    "system.botTokenRequired": "Bot Token 不能為空",
    "system.chatIdRequired": "Chat ID 不能為空",
    "system.telegramConfigRequired": "開啟 Telegram 驗證前，請先填寫 Bot Token 和 Chat ID",
    "system.configInvalid": "系統設定無效",
    "system.telegramConfigInvalid": "Telegram 配置無效",
    "system.fillBotTokenAndChatId": "請先填寫有效的 Bot Token 和 Chat ID",
    "system.telegramTestFailed": "Telegram 測試訊息傳送失敗：{{error}}",

    // analytics
    "analytics.invalidFormat": "{{field}} 格式無效",
    "analytics.startTime": "開始時間",
    "analytics.endTime": "結束時間",
    "analytics.startBeforeEnd": "開始時間必須早於結束時間",
    "analytics.schemaV1Warning": "目前 Analytics Engine dataset 不包含使用日誌基礎欄位，通常表示它是舊的、空的，或並非目前版本寫入的 usage log dataset。",
    "analytics.schemaV2Warning": "目前 Analytics Engine dataset 仍是舊日誌 schema，request id / trace id / IP / UA / 地理位置 / 錯誤摘要 等新欄位需要新版資料列可用後才可查詢。",
};

export default zhTW;
