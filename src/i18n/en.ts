const en: Record<string, string> = {
    // auth
    "auth.telegramRequired": "Telegram login verification is enabled. Please complete verification first",
    "auth.unauthorized": "Unauthorized",

    // system
    "system.botTokenRequired": "Bot Token cannot be empty",
    "system.chatIdRequired": "Chat ID cannot be empty",
    "system.telegramConfigRequired": "Please fill in Bot Token and Chat ID before enabling Telegram verification",
    "system.configInvalid": "Invalid system configuration",
    "system.telegramConfigInvalid": "Invalid Telegram configuration",
    "system.fillBotTokenAndChatId": "Please fill in a valid Bot Token and Chat ID first",
    "system.telegramTestFailed": "Telegram test message failed: {{error}}",

    // analytics
    "analytics.invalidFormat": "{{field}} has invalid format",
    "analytics.startTime": "Start time",
    "analytics.endTime": "End time",
    "analytics.startBeforeEnd": "Start time must be earlier than end time",
    "analytics.schemaV1Warning": "The current Analytics Engine dataset does not contain basic usage log fields, which usually means it is old, empty, or not a usage log dataset written by the current version.",
    "analytics.schemaV2Warning": "The current Analytics Engine dataset is still using the legacy log schema. Fields such as request id / trace id / IP / UA / geolocation / error summary require the new data columns to be available before they can be queried.",
};

export default en;
