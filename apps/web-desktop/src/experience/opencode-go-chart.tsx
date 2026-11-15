import { useId } from 'react'

export interface MonthlyUsageSample {
  at: number
  percent: number
}

const day = 86_400_000
const dateLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const percentLabel = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })
const formatPercent = (value: number) => percentLabel.format(value / 100)

export function OpenCodeGoChart({ monthly, samples = [] }: {
  monthly: { percent: number; resetsAt: string }
  samples?: MonthlyUsageSample[]
}) {
  const title = useId()
  const hatch = useId()
  const renewal = Date.parse(monthly.resetsAt)
  const first = samples[0], latest = samples.at(-1)
  const hasHistory = first && latest && latest.at < renewal
  const elapsed = hasHistory ? (latest.at - first.at) / day : 0
  const change = hasHistory ? latest.percent - first.percent : 0
  const daily = elapsed >= 1 && change >= 0 && monthly.percent < 100 ? change / elapsed : null
  const projection = daily !== null && latest ? latest.percent + daily * (renewal - latest.at) / day : null
  const exhaustion = projection !== null && projection >= 100 && daily && latest
    ? latest.at + (100 - latest.percent) / daily * day
    : null
  const range = hasHistory ? renewal - first.at : 1
  const exhaustionPosition = hasHistory && exhaustion !== null ? (exhaustion - first.at) / range : null
  const chartWidth = 1000, chartHeight = 220
  const peak = Math.max(100, projection ?? 0)
  const step = Math.ceil(peak / 400) * 100
  const ceiling = Math.ceil(peak / step) * step
  const ticks = Array.from({ length: ceiling / step + 1 }, (_, index) => index * step)
  const x = (time: number) => hasHistory ? (time - first.at) / range * chartWidth : 0
  const y = (value: number) => chartHeight * (1 - value / ceiling)
  const points = hasHistory ? samples.map(sample => `${x(sample.at)},${y(sample.percent)}`).join(' ') : ''
  const showExhaustionDate = exhaustion !== null && exhaustionPosition !== null && exhaustionPosition > .25 && exhaustionPosition < .75

  return <section className="browser-usage-chart" aria-labelledby={title}>
    <h2 id={title}>Monthly usage</h2>
    <p className="browser-usage-chart-value">{formatPercent(monthly.percent)}</p>
    <div className="browser-usage-chart-meta">
      <span>Renews <time dateTime={monthly.resetsAt}>{dateLabel.format(renewal)}</time></span>
      {monthly.percent >= 100 && <span className="browser-usage-chart-warning">Monthly limit reached</span>}
      {exhaustion !== null && <span className="browser-usage-chart-warning">On pace to hit the limit {dateLabel.format(exhaustion)}</span>}
    </div>
    {hasHistory && <figure>
      <div className="browser-usage-chart-grid" aria-hidden="true">
        <div className="browser-usage-chart-scale">
          {ticks.map(tick => <span key={tick} style={{ top: `${y(tick) / chartHeight * 100}%` }}>{tick}%</span>)}
        </div>
        <div className="browser-usage-plot">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" focusable="false">
            <defs>
              <pattern id={hatch} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
                <path className="browser-usage-forecast-hatch" d="M0 0 V12" strokeWidth="6" />
              </pattern>
            </defs>
            {ticks.filter(tick => tick !== 100).map(tick => <line key={tick} className="browser-usage-gridline"
              x1="0" x2={chartWidth} y1={y(tick)} y2={y(tick)} vectorEffect="non-scaling-stroke" />)}
            <polygon className="browser-usage-history-fill" points={`0,${chartHeight} ${points} ${x(latest.at)},${chartHeight}`} />
            {projection !== null && <polygon fill={`url(#${hatch})`}
              points={`${x(latest.at)},${chartHeight} ${x(latest.at)},${y(latest.percent)} ${chartWidth},${y(projection)} ${chartWidth},${chartHeight}`} />}
            <line className="browser-usage-limit-line" x1="0" x2={chartWidth} y1={y(100)} y2={y(100)} vectorEffect="non-scaling-stroke" />
            <polyline className="browser-usage-history-line" points={points} vectorEffect="non-scaling-stroke" />
            {projection !== null && <line className="browser-usage-forecast-line" x1={x(latest.at)} x2={chartWidth}
              y1={y(latest.percent)} y2={y(projection)} vectorEffect="non-scaling-stroke" />}
          </svg>
          <span className="browser-usage-plot-point" style={{ left: `${x(latest.at) / chartWidth * 100}%`, top: `${y(latest.percent) / chartHeight * 100}%` }} />
          {exhaustionPosition !== null && <span className="browser-usage-plot-point is-forecast"
            style={{ left: `${exhaustionPosition * 100}%`, top: `${y(100) / chartHeight * 100}%` }} />}
          {projection !== null && <>
            <span className="browser-usage-plot-point is-forecast" style={{ left: '100%', top: `${y(projection) / chartHeight * 100}%` }} />
            <span className="browser-usage-forecast-value" style={{ top: `${y(projection) / chartHeight * 100}%` }}>{formatPercent(projection)}</span>
          </>}
        </div>
        <div className="browser-usage-chart-dates">
          <span>{dateLabel.format(first.at)}</span>
          {showExhaustionDate && <span className="browser-usage-chart-warning"
            style={{ left: `${exhaustionPosition * 100}%` }}>{dateLabel.format(exhaustion)}</span>}
          <span>{dateLabel.format(renewal)}</span>
        </div>
      </div>
      <figcaption>
        {elapsed > 0 && <p className="sr-only">Recorded usage went from {formatPercent(first.percent)} on {dateLabel.format(first.at)} to {formatPercent(latest.percent)} on {dateLabel.format(latest.at)}.</p>}
        {daily !== null && projection !== null && <p>
          Averaging <strong>{formatPercent(daily)}</strong> of the limit per day<span className="sr-only">. {formatPercent(projection)} projected at renewal.</span>
        </p>}
        {daily === null && monthly.percent < 100 && <p>{elapsed < 1
          ? 'A forecast appears after 24 hours of recorded usage.'
          : 'A forecast is unavailable because recorded usage decreased.'}</p>}
        <ul className="browser-usage-chart-legend" role="list">
          <li>Usage</li>{projection !== null && <li className="is-forecast">Forecast</li>}<li className="is-limit">Monthly limit</li>
        </ul>
      </figcaption>
    </figure>}
    {!hasHistory && <p className="browser-usage-chart-note">Usage history appears as Athena records monthly readings.</p>}
  </section>
}
