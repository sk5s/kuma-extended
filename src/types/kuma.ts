export interface StatusPageConfig {
  slug: string
  title: string
  description: string
  icon: string
  autoRefreshInterval: number
  theme: string
  published: boolean
  showTags: boolean
  customCSS: string
  footerText: string
  showPoweredBy: boolean
  analyticsId: string | null
  analyticsScriptUrl: string | null
  analyticsType: string | null
  showCertificateExpiry: boolean
  showOnlyLastHeartbeat: boolean
  rssTitle: string | null
}

export interface Incident {
  id: number
  style: string
  title: string
  content: string
  pin: boolean
  active: boolean
  createdDate: string
  lastUpdatedDate: string | null
  status_page_id: number
}

export interface StatusPageMonitor {
  id: number
  name: string
  sendUrl: number
  type: string
}

export interface StatusPageGroup {
  id: number
  name: string
  weight: number
  monitorList: StatusPageMonitor[]
}

export interface MaintenanceTimeslot {
  startDate: string
  endDate: string
}

export interface MaintenanceTimeRange {
  hours: number
  minutes: number
}

export interface Maintenance {
  id: number
  title: string
  description: string
  strategy: string
  intervalDay: number
  active: boolean
  dateRange: string[]
  timeRange: MaintenanceTimeRange[]
  weekdays: number[]
  daysOfMonth: string[]
  timeslotList: MaintenanceTimeslot[]
  cron: string
  durationMinutes: number | null
  timezone: string
  timezoneOption: string
  timezoneOffset: string
  status: string
}

export interface KumaStatusPage {
  config: StatusPageConfig
  incidents: Incident[]
  publicGroupList: StatusPageGroup[]
  maintenanceList: Maintenance[]
}
