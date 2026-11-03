import { useState } from 'react'
import { useBrowserScheduledTasks } from '../upstream/scheduled-tasks'
import './scheduled-tasks.css'

function runTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function ScheduledTasksPage() {
  const model = useBrowserScheduledTasks()
  const [query, setQuery] = useState('')
  const [profile, setProfile] = useState('')
  const selectedProfile = model.profiles.some(item => item.key === profile) ? profile : ''
  const search = query.trim().toLocaleLowerCase()
  const tasks = model.tasks.filter(task => (!selectedProfile || task.profile === selectedProfile) &&
    [task.title, task.profileLabel, task.profile, task.prompt, task.script, task.schedule, task.state].some(value => value?.toLocaleLowerCase().includes(search)))

  return <section className="browser-scheduled-tasks" aria-label="Scheduled tasks">
    <header>
      <div><h1>Scheduled tasks</h1><p>View scheduled tasks across all profiles.</p></div>
      <button type="button" disabled={!model.connected || model.refreshing} onClick={model.refresh}>{model.refreshing ? 'Refreshing…' : 'Refresh'}</button>
    </header>
    <div className="browser-scheduled-tasks-filters">
      <label>Search tasks<input type="search" placeholder="Search scheduled tasks" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>Profile<select aria-label="Profile" value={selectedProfile} onChange={event => setProfile(event.target.value)}>
        <option value="">All profiles</option>
        {model.profiles.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select></label>
    </div>
    {!model.connected && <p role="status">Connect to your gateway to view scheduled tasks.</p>}
    {model.errors.length > 0 && <p role="alert">Could not refresh tasks for {model.errors.map(item => item.label).join(', ')}. Check your connection and try Refresh.</p>}
    <p role="status">{model.loading ? 'Loading scheduled tasks…' : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}</p>
    {model.connected && !model.loading && !tasks.length && (model.tasks.length > 0 || !model.errors.length) && <p>{model.tasks.length ? 'No tasks match your search or profile filter.' : 'No scheduled tasks yet across your profiles.'}</p>}
    <div className="browser-scheduled-tasks-list">
      {tasks.map(task => <details key={task.key} className="browser-scheduled-task">
        <summary>
          <span className="browser-scheduled-task-title"><strong>{task.title}</strong><span>{task.profileLabel} · {task.schedule}</span></span>
          <span className="browser-scheduled-task-state" data-state={task.overdue ? 'error' : task.state}>{task.overdue ? 'Overdue' : task.state}</span>
        </summary>
        <dl>
          <div><dt>Profile</dt><dd>{task.profileLabel}</dd></div>
          <div><dt>Schedule</dt><dd>{task.schedule}</dd></div>
          <div><dt>{task.overdue ? 'Overdue since' : 'Next run'}</dt><dd>{runTime(task.nextRun)}</dd></div>
          <div><dt>Last run</dt><dd>{runTime(task.lastRun)}</dd></div>
          <div><dt>Delivery</dt><dd>{task.delivery || 'local'}</dd></div>
        </dl>
        {task.prompt && <div className="browser-scheduled-task-content"><h2>Instructions</h2><p>{task.prompt}</p></div>}
        {task.script && <div className="browser-scheduled-task-content"><h2>Script</h2><pre>{task.script}</pre></div>}
        {task.error && <div className="browser-scheduled-task-content" role="note"><h2>Last error</h2><p>{task.error}</p></div>}
      </details>)}
    </div>
  </section>
}
