/** Schedule optional background work, including browsers without the idle API. */
export function scheduleBrowserIdleTask(task: () => void): () => void {
  if (typeof requestIdleCallback === 'function' && typeof cancelIdleCallback === 'function') {
    const id = requestIdleCallback(task, { timeout: 5_000 })
    return () => cancelIdleCallback(id)
  }

  const id = setTimeout(task, 0)
  return () => clearTimeout(id)
}
