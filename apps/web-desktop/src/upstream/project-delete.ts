import type { HermesGateway } from '@/hermes'
import type { ProjectsPayload } from '@/types/hermes'

/** The combined project tree omits ownership, so resolve the exact saved id before deleting. */
export async function browserProjectDeleteProfile(
  gateway: Pick<HermesGateway, 'request'>,
  id: string,
  profiles: readonly string[]
): Promise<string> {
  const names = [...new Set(profiles)]
  // Fail before deleting if any profile cannot be read: a partial lookup cannot
  // distinguish a unique owner from a copied project id in another profile.
  const lists = await Promise.all(names.map(profile => gateway.request<ProjectsPayload>('projects.list', { profile })))
  const owners = names.filter((_profile, index) => lists[index].projects.some(project => project.id === id))
  if (owners.length > 1) throw new Error('This project exists in multiple profiles. Select its profile before deleting it.')
  if (!owners.length) throw new Error('This project could not be found. Refresh Projects and try again.')
  return owners[0]
}
