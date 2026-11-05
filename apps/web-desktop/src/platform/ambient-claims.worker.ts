import { createAmbientClaimArbiter } from '../upstream/ambient-claims'

const owns = createAmbientClaimArbiter()
const worker = self as unknown as { onconnect: ((event: MessageEvent) => void) | null }

/** One serial owner per browser worker; the renderer supplies cue timing policy. */
worker.onconnect = event => {
  const port = event.ports[0]
  port.onmessage = ({ data }) => {
    if (!Number.isSafeInteger(data?.id) || typeof data?.key !== 'string' ||
      typeof data?.scope !== 'string' || !/^[a-f0-9]{64}$/.test(data.scope)) return
    // Preserve the speech discriminator while isolating gateway identities.
    const prefix = data.key.startsWith('speak:') ? 'speak:' : ''
    const key = `${prefix}${data.scope}:${data.key.slice(prefix.length)}`
    port.postMessage({ id: data.id, owns: owns(key) })
  }
  port.start()
}
