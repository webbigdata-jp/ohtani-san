// src/db/migrations.ts
import { Kysely, Migration, MigrationProvider } from 'kysely'

const migrations: Record<string, Migration> = { // ここで定義
  '001': { // キーを指定
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable('post')
        .addColumn('uri', 'varchar', (col) => col.primaryKey())
        .addColumn('cid', 'varchar', (col) => col.notNull())
        .addColumn('indexedAt', 'varchar', (col) => col.notNull())
        .execute()
      await db.schema
        .createTable('sub_state')
        .addColumn('service', 'varchar', (col) => col.primaryKey())
        .addColumn('cursor', 'integer', (col) => col.notNull())
        .execute()
      // 新しく追加する lhl_list テーブル
      await db.schema
        .createTable('lhl_list')
        .addColumn('uri', 'varchar', (col) => col.primaryKey())
        .addColumn('cid', 'varchar', (col) => col.notNull())
        .addColumn('indexedAt', 'varchar', (col) => col.notNull())
        .addColumn('isRelevant', 'boolean', (col) => col.notNull())
        .execute()
    },
    async down(db: Kysely<unknown>) {
      await db.schema.dropTable('post').execute()
      await db.schema.dropTable('sub_state').execute()
      await db.schema.dropTable('lhl_list').execute()
    },
  },
}

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
}

