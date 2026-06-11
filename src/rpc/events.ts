// Events triggered by SettingsWindow that update the view in AppWindow
export const TIME_FORMAT_CHANGED = "time-format-changed"
export const DEFAULT_REMINDERS_CHANGED = "default-reminders-changed"
export const DEFAULT_CALENDAR_CHANGED = "default-calendar-changed"
export const CALENDAR_DIR_CHANGED = "calendar-dir-changed"
export const CALDIR_CHANGED = "caldir-changed"
export const THEME_CHANGED = "theme-changed"
export const NOTIFICATIONS_ENABLED_CHANGED = "notifications-enabled-changed"
export const AUTO_SYNC_ENABLED_CHANGED = "auto-sync-enabled-changed"
export const START_AT_LOGIN_CHANGED = "start-at-login-changed"
export const EXTRA_TIMEZONES_CHANGED = "extra-timezones-changed"
export const TIMEZONE_LABELS_CHANGED = "timezone-labels-changed"
export const WEATHER_SETTINGS_CHANGED = "weather-settings-changed"
// Local-only calendar customizations (kept in localStorage) that the main
// window's sidebar/views must reflect when edited from the Settings window.
export const ACCOUNT_NAME_OVERRIDES_CHANGED = "account-name-overrides-changed"
export const CALENDAR_COLOR_OVERRIDES_CHANGED = "calendar-color-overrides-changed"
