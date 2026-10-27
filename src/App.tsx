import { createMemo, createSignal, Errored, For, Loading, onSettled, Show } from 'solid-js'
import { addTodo, deleteTodo, listTodos, toggleTodo } from './db'
import { createUpdater } from './updates'
import './App.css'

export default function App() {
  const [revision, setRevision] = createSignal(0)
  const [draft, setDraft] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)

  const updater = createUpdater()

  // Async memo: Solid 2 has no createResource. Reading `todos()` under
  // <Loading> suspends until the list resolves; bumping `revision` refetches.
  const todos = createMemo(async () => {
    revision()
    return listTodos()
  })

  const refresh = () => setRevision(n => n + 1)

  // Writes reject silently unless caught: a denied IPC permission never
  // reaches <Errored>, which only sees render-phase failures.
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setError(null)
    try {
      await action()
      refresh()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    const title = draft().trim()
    if (!title) return
    if (await run(() => addTodo(title))) setDraft('')
  }

  const handleToggle = (id: number, done: boolean) => run(() => toggleTodo(id, done))

  const handleDelete = (id: number) => run(() => deleteTodo(id))

  const statusLabel = createMemo(() => {
    const s = updater.status()
    switch (s.kind) {
      case 'idle':
        return 'Not checked yet'
      case 'checking':
        return 'Checking for updates…'
      case 'current':
        return "You're on the latest version"
      case 'available':
        return `v${s.version} is available`
      case 'downloading':
        return `Downloading ${s.percent}%`
      case 'ready':
        return 'Installed — restarting'
      case 'error':
        return 'Update check failed'
    }
  })

  const progress = createMemo(() => {
    const s = updater.status()
    return s.kind === 'downloading' ? s.percent : null
  })

  const updateError = createMemo(() => {
    const s = updater.status()
    return s.kind === 'error' ? s.message : null
  })

  const available = createMemo(() => {
    const s = updater.status()
    return s.kind === 'available' ? s : null
  })

  const busy = () => updater.status().kind === 'checking' || updater.status().kind === 'downloading'

  // Startup check is silent: until a release host exists, a failed check is
  // the normal case and should not shout at the user.
  onSettled(() => {
    void updater.loadVersion()
    void updater.checkNow(true)
  })

  return (
    <main class="app">
      <header class="head">
        <h1>LifeOS</h1>
        <p class="muted">Todos · local SQLite</p>
      </header>

      <form class="composer" onSubmit={handleSubmit}>
        <input
          value={draft()}
          onInput={e => setDraft(e.currentTarget.value)}
          placeholder="What needs doing?"
          autofocus
        />
        <button type="submit">Add</button>
      </form>

      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>

      <Errored fallback={err => <p class="error">Database error: {String(err())}</p>}>
        <Loading fallback={<p class="muted">Loading…</p>}>
          <Show when={todos().length > 0} fallback={<p class="muted">Nothing yet. Add your first task.</p>}>
            <ul class="todos">
              <For each={todos()}>
                {todo => (
                  <li class={['todo', { done: todo.done === 1 }]}>
                    <label>
                      <input
                        type="checkbox"
                        checked={todo.done === 1}
                        onChange={e => handleToggle(todo.id, e.currentTarget.checked)}
                      />
                      <span>{todo.title}</span>
                    </label>
                    <button class="delete" onClick={() => handleDelete(todo.id)} aria-label="Delete">
                      ×
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Loading>
      </Errored>

      <section class="updates">
        <div class="updates-head">
          <h2>Updates</h2>
          <span class="muted">{updater.appVersion() ? `v${updater.appVersion()}` : 'dev'}</span>
        </div>

        <p class="muted">{statusLabel()}</p>

        <Show when={available()}>
          {update => (
            <Show when={update().notes}>
              <p class="notes">{update().notes}</p>
            </Show>
          )}
        </Show>

        <Show when={progress()}>
          <div class="bar">
            <div class="bar-fill" style={{ width: `${progress()}%` }} />
          </div>
        </Show>

        <Show when={updateError()}>
          <p class="error">{updateError()}</p>
        </Show>

        <div class="updates-actions">
          <button class="ghost" disabled={busy()} onClick={() => updater.checkNow()}>
            Check for updates
          </button>
          <Show when={available()}>
            {update => (
              <button class="primary" disabled={busy()} onClick={() => updater.install()}>
                Install v{update().version}
              </button>
            )}
          </Show>
        </div>
      </section>
    </main>
  )
}
