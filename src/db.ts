import Database from '@tauri-apps/plugin-sql'

export interface Todo {
  id: number
  title: string
  done: number
  created_at: string
}

let connection: Promise<Database> | null = null

/** One connection per app session; the plugin opens the file lazily. */
function db(): Promise<Database> {
  connection ??= Database.load('sqlite:lifeos.db')
  return connection
}

export async function listTodos(): Promise<Todo[]> {
  return (await db()).select<Todo[]>(
    'SELECT id, title, done, created_at FROM todos ORDER BY done, id DESC',
  )
}

export async function addTodo(title: string): Promise<void> {
  await (await db()).execute('INSERT INTO todos (title) VALUES ($1)', [title])
}

export async function toggleTodo(id: number, done: boolean): Promise<void> {
  await (await db()).execute('UPDATE todos SET done = $1 WHERE id = $2', [done ? 1 : 0, id])
}

export async function deleteTodo(id: number): Promise<void> {
  await (await db()).execute('DELETE FROM todos WHERE id = $1', [id])
}
