import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import type { SettingsControl, SettingsFrameDescriptor } from '../contracts/settings-presentation'
import { createSettingsDescriptor, registerSettingsDescriptor, registerSettingsFrame, settingsPresentationChanged } from '../../platform/settings-presentation'

/** Publish committed projections only; React and Hermes retain values and save ownership. */
export function useSettingsPresentation<T extends HTMLElement = HTMLElement>(controls: readonly SettingsControl[] | null, existing?: RefObject<T | null>): RefObject<T | null> {
  const ownRef = useRef<T>(null)
  const ref = existing ?? ownRef
  const latest = useRef(controls ?? [])
  const registration = useRef<{ element: T; release(): void } | null>(null)
  const descriptor = useMemo(() => createSettingsDescriptor(() => latest.current), [])
  useLayoutEffect(() => { latest.current = controls ?? []; settingsPresentationChanged() })
  useLayoutEffect(() => {
    const element = controls ? ref.current : null
    if (registration.current?.element === element) return
    registration.current?.release()
    registration.current = element ? { element, release: registerSettingsDescriptor(element, descriptor) } : null
  })
  useLayoutEffect(() => () => { registration.current?.release(); registration.current = null }, [])
  return ref
}

export function useSettingsFramePresentation(frame: SettingsFrameDescriptor): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef(frame)
  const registration = useRef<{ element: HTMLDivElement; release(): void } | null>(null)
  const snapshot = useMemo(() => () => latest.current, [])
  useLayoutEffect(() => { latest.current = frame; settingsPresentationChanged() })
  useLayoutEffect(() => {
    if (registration.current?.element === ref.current) return
    registration.current?.release()
    registration.current = ref.current ? { element: ref.current, release: registerSettingsFrame(ref.current, snapshot) } : null
  })
  useLayoutEffect(() => () => { registration.current?.release(); registration.current = null }, [])
  return ref
}
