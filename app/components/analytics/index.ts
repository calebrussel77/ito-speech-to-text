// Analytics disabled: provide no-op implementations and event names for type safety.

export const ANALYTICS_EVENTS = {
  // Auth
  AUTH_SIGNIN_STARTED: 'auth_signin_started',
  AUTH_SIGNIN_COMPLETED: 'auth_signin_completed',
  AUTH_SIGNIN_FAILED: 'auth_signin_failed',
  AUTH_SIGNUP_STARTED: 'auth_signup_started',
  AUTH_LOGOUT: 'auth_logout',
  AUTH_LOGOUT_FAILED: 'auth_logout_failed',
  AUTH_METHOD_FAILED: 'auth_method_failed',
  AUTH_STATE_GENERATION_FAILED: 'auth_state_generation_failed',

  // Onboarding
  ONBOARDING_STARTED: 'onboarding_started',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  ONBOARDING_STEP_VIEWED: 'onboarding_step_viewed',
  ONBOARDING_STEP_COMPLETED: 'onboarding_step_completed',

  // Settings
  SETTING_CHANGED: 'setting_changed',
  MICROPHONE_CHANGED: 'microphone_changed',
  KEYBOARD_SHORTCUTS_CHANGED: 'keyboard_shortcuts_changed',

  // Recording
  RECORDING_STARTED: 'recording_started',
  RECORDING_COMPLETED: 'recording_completed',
  MANUAL_RECORDING_STARTED: 'manual_recording_started',
  MANUAL_RECORDING_COMPLETED: 'manual_recording_completed',
  MANUAL_RECORDING_ABANDONED: 'manual_recording_abandoned',
} as const

class NoOpAnalytics {
  enableAnalytics(..._args: any[]) {}
  disableAnalytics(..._args: any[]) {}
  isEnabled() {
    return false
  }
  identifyUser(..._args: any[]) {}
  updateUserProperties(..._args: any[]) {}
  track(..._args: any[]) {}
  trackAuth(..._args: any[]) {}
  trackSettings(..._args: any[]) {}
  trackOnboarding(..._args: any[]) {}
  resetUser(..._args: any[]) {}
  getSessionDuration() {
    return 0
  }
}

export const analytics = new NoOpAnalytics()
export const trackEvent = analytics.track.bind(analytics)
export const identifyUser = analytics.identifyUser.bind(analytics)
export const updateUserProperties =
  analytics.updateUserProperties.bind(analytics)
export const resetAnalytics = analytics.resetUser.bind(analytics)

export const updateAnalyticsFromSettings = (_shareAnalytics: boolean) => {
  // no-op
}
