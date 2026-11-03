import type { ConfigFieldSchema } from '@/types/hermes'
import type { SettingsControl } from '../experience/contracts/settings-presentation'
import { useSettingsPresentation } from '../experience/settings/presentation'

interface FieldPresentation {
  schemaKey: string
  schema: ConfigFieldSchema
  value: unknown
  enumOptions?: string[]
  optionLabels?: Record<string, string>
  label: string
  description?: string
  onChange(value: unknown): void
  parseList(raw: string): string[]
  prettyName(value: string): string
  emptyLabel: string
  defaultLabel: string
  extended: boolean
}

/** Project the renderer's resolved field metadata and original commit command. */
export function configFieldPresentation(field: FieldPresentation): SettingsControl[] | null {
  const { schemaKey, schema, value, label, description, onChange } = field
  // Structured editors and extension actions retain their existing presentation.
  if (field.extended || schemaKey === 'fallback_providers') return null
  const base = { id: schemaKey, label, description }
  if (schema.type === 'boolean') return [{ ...base, kind: 'toggle', checked: Boolean(value), run: () => onChange(!Boolean(value)) }]
  const options = field.enumOptions ?? (schema.type === 'select' ? schema.options?.map(String) : undefined)
  if (options) {
    const choices = schema.searchable ? [
      ...(schema.clearable ? [{ label: field.defaultLabel, value: '' }] : []),
      ...options.filter(option => option !== '').map(option => ({ label: option, value: option }))
    ] : options.map(option => ({ label: option ? field.optionLabels?.[option] ?? field.prettyName(option) : field.emptyLabel, value: option }))
    return [{ ...base, kind: 'select', value: String(value ?? ''), options: choices, run: next => onChange(next) }]
  }
  if (schema.type === 'number') return [{ ...base, kind: 'input', inputType: 'number',
    value: value == null ? '' : String(value), run: raw => {
      const number = raw === '' ? 0 : Number(raw)
      if (!Number.isNaN(number)) onChange(number)
    } }]
  if (schema.type === 'list') return [{ ...base, kind: 'input', value: Array.isArray(value) ? value.join(', ') : String(value ?? ''),
    run: raw => onChange(field.parseList(String(raw))) }]
  if (typeof value === 'object' && value !== null) return [{ ...base, kind: 'input', inputType: 'textarea', value: JSON.stringify(value, null, 2),
    run: raw => { try { onChange(JSON.parse(String(raw))) } catch { /* The renderer retains its last valid JSON value. */ } } }]
  const text = String(value ?? '')
  return [{ ...base, kind: 'input', inputType: schema.type === 'text' || text.length > 100 ? 'textarea' : 'text', value: text,
    run: raw => onChange(raw) }]
}

export function useBrowserConfigFieldPresentation(field: FieldPresentation) {
  return useSettingsPresentation<HTMLDivElement>(configFieldPresentation(field))
}
