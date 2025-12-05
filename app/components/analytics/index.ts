// Analytics is disabled. All exports are safe no-ops.
export const ANALYTICS_EVENTS = {} as const

class NoOpAnalytics {
  isEnabled() {
    return false
  }
  enableAnalytics() {}
  disableAnalytics() {}
  identifyUser() {}
  updateUserProperties() {}
  track() {}
  trackAuth() {}
  trackSettings() {}
  trackOnboarding() {}
  resetUser() {}
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
