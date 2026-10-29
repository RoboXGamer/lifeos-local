use serde_json::{Map, Value};
use sqlx::{
    sqlite::SqliteConnectOptions, Column, Connection, Row, SqliteConnection, TypeInfo, ValueRef,
};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct TransactionState(Mutex<Option<(String, SqliteConnection)>>);

#[tauri::command]
pub async fn begin(
    app: AppHandle,
    state: State<'_, TransactionState>,
    id: String,
) -> Result<(), String> {
    let mut active = state.0.lock().await;
    if active.is_some() {
        return Err("A database transaction is already active".into());
    }
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("lifeos.db");
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(10));
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut connection)
        .await
        .map_err(|e| e.to_string())?;
    *active = Some((id.clone(), connection));
    // If the webview disappears mid-mutation, do not hold the write lock forever.
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(120)).await;
        let state = app.state::<TransactionState>();
        let mut active = state.0.lock().await;
        if active.as_ref().map(|(owner, _)| owner.as_str()) == Some(id.as_str()) {
            if let Some((_, mut connection)) = active.take() {
                let _ = sqlx::query("ROLLBACK").execute(&mut connection).await;
            }
        }
    });
    Ok(())
}

fn bind<'a>(
    sql: &'a str,
    values: Vec<Value>,
) -> Result<sqlx::query::Query<'a, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'a>>, String> {
    let mut query = sqlx::query(sql);
    for value in values {
        query = match value {
            Value::Null => query.bind(None::<String>),
            Value::String(value) => query.bind(value),
            Value::Bool(value) => query.bind(value),
            Value::Number(value) => {
                if let Some(value) = value.as_i64() {
                    query.bind(value)
                } else if let Some(value) = value.as_f64() {
                    query.bind(value)
                } else {
                    return Err("Unsupported number".into());
                }
            }
            _ => return Err("Unsupported SQL parameter".into()),
        };
    }
    Ok(query)
}

#[tauri::command]
pub async fn execute(
    state: State<'_, TransactionState>,
    id: String,
    sql: String,
    params: Vec<Value>,
) -> Result<(), String> {
    let mut active = state.0.lock().await;
    let (owner, connection) = active.as_mut().ok_or("No active transaction")?;
    if *owner != id {
        return Err("Transaction ID does not match".into());
    }
    bind(&sql, params)?
        .execute(connection)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn select(
    state: State<'_, TransactionState>,
    id: String,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
    let mut active = state.0.lock().await;
    let (owner, connection) = active.as_mut().ok_or("No active transaction")?;
    if *owner != id {
        return Err("Transaction ID does not match".into());
    }
    let rows = bind(&sql, params)?
        .fetch_all(connection)
        .await
        .map_err(|e| e.to_string())?;
    rows.into_iter()
        .map(|row| {
            let mut result = Map::new();
            for (i, col) in row.columns().iter().enumerate() {
                let value = row.try_get_raw(i).map_err(|e| e.to_string())?;
                let v = if value.is_null() {
                    Value::Null
                } else {
                    match value.type_info().name() {
                        "INTEGER" | "INT" | "BOOLEAN" => {
                            Value::from(row.try_get::<i64, _>(i).map_err(|e| e.to_string())?)
                        }
                        "REAL" | "FLOAT" => {
                            Value::from(row.try_get::<f64, _>(i).map_err(|e| e.to_string())?)
                        }
                        "TEXT" => {
                            Value::from(row.try_get::<String, _>(i).map_err(|e| e.to_string())?)
                        }
                        kind => return Err(format!("Unsupported SQLite type: {kind}")),
                    }
                };
                result.insert(col.name().to_owned(), v);
            }
            Ok(result)
        })
        .collect()
}

#[tauri::command]
pub async fn finish(
    state: State<'_, TransactionState>,
    id: String,
    commit: bool,
) -> Result<(), String> {
    let mut active = state.0.lock().await;
    if active.as_ref().map(|(owner, _)| owner.as_str()) != Some(id.as_str()) {
        return Err("Transaction ID does not match".into());
    }
    let (_, mut connection) = active.take().ok_or("No active transaction")?;
    let sql = if commit { "COMMIT" } else { "ROLLBACK" };
    if let Err(error) = sqlx::query(sql).execute(&mut connection).await {
        let _ = sqlx::query("ROLLBACK").execute(&mut connection).await;
        return Err(error.to_string());
    }
    Ok(())
}
