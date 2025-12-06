import { getDb } from './db'
import type sqlite3 from 'sqlite3'

// Overloaded signatures: accept either no db (uses getDb()) or explicit db instance
export function run(query: string, params?: any[]): Promise<void>
export function run(
  db: sqlite3.Database,
  query: string,
  params?: any[],
): Promise<void>
export function run(
  dbOrQuery: sqlite3.Database | string,
  queryOrParams?: string | any[],
  params?: any[],
): Promise<void> {
  // Determine which overload was used
  let database: sqlite3.Database
  let query: string
  let queryParams: any[]

  if (typeof dbOrQuery === 'string') {
    // First overload: run(query, params?)
    database = getDb()
    query = dbOrQuery
    queryParams = (queryOrParams as any[]) ?? []
  } else {
    // Second overload: run(db, query, params?)
    database = dbOrQuery
    query = queryOrParams as string
    queryParams = params ?? []
  }

  return new Promise((resolve, reject) => {
    database.run(query, queryParams, function (err) {
      if (err) return reject(err)
      resolve()
    })
  })
}

export function exec(query: string): Promise<void>
export function exec(db: sqlite3.Database, query: string): Promise<void>
export function exec(
  dbOrQuery: sqlite3.Database | string,
  query?: string,
): Promise<void> {
  let database: sqlite3.Database
  let sql: string

  if (typeof dbOrQuery === 'string') {
    database = getDb()
    sql = dbOrQuery
  } else {
    database = dbOrQuery
    sql = query as string
  }

  return new Promise((resolve, reject) => {
    database.exec(sql, function (err) {
      if (err) return reject(err)
      resolve()
    })
  })
}

export function get<T>(query: string, params?: any[]): Promise<T | undefined>
export function get<T>(
  db: sqlite3.Database,
  query: string,
  params?: any[],
): Promise<T | undefined>
export function get<T>(
  dbOrQuery: sqlite3.Database | string,
  queryOrParams?: string | any[],
  params?: any[],
): Promise<T | undefined> {
  let database: sqlite3.Database
  let query: string
  let queryParams: any[]

  if (typeof dbOrQuery === 'string') {
    database = getDb()
    query = dbOrQuery
    queryParams = (queryOrParams as any[]) ?? []
  } else {
    database = dbOrQuery
    query = queryOrParams as string
    queryParams = params ?? []
  }

  return new Promise((resolve, reject) => {
    database.get(query, queryParams, (err, row: T) => {
      if (err) return reject(err)
      resolve(row)
    })
  })
}

export function all<T>(query: string, params?: any[]): Promise<T[]>
export function all<T>(
  db: sqlite3.Database,
  query: string,
  params?: any[],
): Promise<T[]>
export function all<T>(
  dbOrQuery: sqlite3.Database | string,
  queryOrParams?: string | any[],
  params?: any[],
): Promise<T[]> {
  let database: sqlite3.Database
  let query: string
  let queryParams: any[]

  if (typeof dbOrQuery === 'string') {
    database = getDb()
    query = dbOrQuery
    queryParams = (queryOrParams as any[]) ?? []
  } else {
    database = dbOrQuery
    query = queryOrParams as string
    queryParams = params ?? []
  }

  return new Promise((resolve, reject) => {
    database.all(query, queryParams, (err, rows: T[]) => {
      if (err) return reject(err)
      resolve(rows)
    })
  })
}
