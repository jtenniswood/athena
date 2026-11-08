/** Latest prompt occupancy, distinct from cumulative session token totals. */
export interface BrowserContextUsage {
  used: number | null
  capacity: number | null
  estimated: boolean
  loading: boolean
}
