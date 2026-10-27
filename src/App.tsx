import { createSignal } from 'solid-js'
import './App.css'

export default function App() {
  const [count, setCount] = createSignal(0)

  return (
    <main class="app">
      <h1>Tauri + Solid 2</h1>
      <p class="muted">local-first scaffold — SQLite next</p>
      <button class="increment" onClick={() => setCount(count() + 1)}>
        Clicks: {count()}
      </button>
    </main>
  )
}
