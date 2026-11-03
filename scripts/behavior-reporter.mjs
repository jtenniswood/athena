/** Machine-readable execution evidence from Node's actual test events. */
export default async function* report(events) {
  for await (const { type, data } of events) {
    if (!['test:pass', 'test:fail'].includes(type)) continue
    if (data.details?.type === 'suite') continue
    yield JSON.stringify({ name: data.name, file: data.file, status: data.skip || data.todo ? 'skipped' : type === 'test:pass' ? 'passed' : 'failed', error: data.details?.error?.message }) + '\n'
  }
}
