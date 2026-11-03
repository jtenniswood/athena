import { useStore } from '@nanostores/react'
import { useQueries } from '@tanstack/react-query'
import { getCronJobs } from '@/api/cron'
import { jobState, jobTitle, nextRunOverdueMs } from '@/app/cron/job-state'
import { $activeConnectionId } from '@/store/connections'
import { $activeGatewayProfile, $profiles } from '@/store/profile'
import { $gatewayState } from '@/store/session'

/** Read each profile separately: the aggregate endpoint deduplicates copied job IDs. */
export function useBrowserScheduledTasks() {
  const configured = useStore($profiles)
  const active = useStore($activeGatewayProfile)
  const connection = useStore($activeConnectionId)
  const connected = useStore($gatewayState) === 'open'
  const profiles = configured.length ? configured.map(profile => ({ key: profile.name, label: profile.display_name || profile.name })) : [{ key: active, label: active }]
  const results = useQueries({ queries: profiles.map(profile => ({
    queryKey: ['browser-scheduled-tasks', connection, profile.key],
    queryFn: () => getCronJobs(profile.key),
    enabled: connected,
    refetchInterval: 30_000,
    retry: 1
  })) })
  return {
    connected,
    profiles,
    loading: connected && results.some(result => result.isPending),
    refreshing: results.some(result => result.isFetching),
    errors: profiles.filter((_, index) => results[index].isError),
    refresh: () => { for (const result of results) void result.refetch() },
    tasks: results.flatMap((result, index) => (result.data ?? []).map(job => ({
      key: JSON.stringify([profiles[index].key, job.id]),
      profile: profiles[index].key,
      profileLabel: profiles[index].label,
      title: jobTitle(job),
      state: jobState(job),
      overdue: nextRunOverdueMs(job) !== null,
      schedule: job.schedule_display || job.schedule?.display || job.schedule?.expr || 'No schedule',
      nextRun: job.next_run_at,
      lastRun: job.last_run_at,
      prompt: job.prompt,
      script: job.script,
      delivery: job.deliver,
      error: job.last_error
    })))
  }
}
