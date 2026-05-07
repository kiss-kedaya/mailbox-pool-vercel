import { neon } from '@neondatabase/serverless';

const tableName = 'mailbox_pool_items';
const consumedTableName = 'mailbox_pool_consumed_items';

type MailboxRow = {
  mailbox: string;
};

type CountRow = {
  count: string | number;
};

export type ImportResult = {
  added: number;
  ignored: number;
  existingIgnored: number;
  consumedIgnored: number;
  count: number;
};

function getSql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }
  return neon(databaseUrl);
}

let ensureTablePromise: Promise<ReturnType<typeof getSql>> | null = null;

async function ensureTable() {
  ensureTablePromise ||= (async () => {
    const sql = getSql();
    await sql.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id BIGSERIAL PRIMARY KEY,
        mailbox TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql.query(`
      CREATE TABLE IF NOT EXISTS ${consumedTableName} (
        mailbox_key TEXT PRIMARY KEY,
        mailbox TEXT NOT NULL,
        consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sql.query(`
      DELETE FROM ${tableName} a
      USING ${tableName} b
      WHERE LOWER(TRIM(SPLIT_PART(a.mailbox, '----', 1))) = LOWER(TRIM(SPLIT_PART(b.mailbox, '----', 1)))
        AND a.id > b.id
    `);
    await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${tableName}_mailbox_key_unique ON ${tableName} (LOWER(TRIM(SPLIT_PART(mailbox, '----', 1))))`);
    return sql;
  })();
  return ensureTablePromise;
}

export function requireAdminToken(request: Request) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return;

  const auth = request.headers.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const headerToken = request.headers.get('x-admin-token') || '';

  if (bearer !== token && headerToken !== token) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
}

export function parseMailboxText(text: string) {
  const seen = new Set<string>();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const mailboxes: string[] = [];
  let ignored = 0;

  for (const line of lines) {
    const mailboxKey = line.split('----', 1)[0].trim().toLowerCase();
    if (seen.has(mailboxKey)) {
      ignored += 1;
      continue;
    }
    seen.add(mailboxKey);
    mailboxes.push(line);
  }

  return { mailboxes, ignored };
}

export async function importMailboxes(text: string): Promise<ImportResult> {
  const { mailboxes, ignored } = parseMailboxText(text);
  const sql = await ensureTable();
  let added = 0;
  let consumedIgnored = 0;

  if (mailboxes.length > 0) {
    const placeholders = mailboxes.map((_, index) => `($${index + 1})`).join(',');
    const consumedRows = await sql.query(
      `WITH incoming(mailbox) AS (VALUES ${placeholders})
       SELECT COUNT(*) AS count
       FROM incoming
       WHERE EXISTS (
         SELECT 1 FROM ${consumedTableName} consumed
         WHERE consumed.mailbox_key = LOWER(TRIM(SPLIT_PART(incoming.mailbox, '----', 1)))
       )`,
      mailboxes,
    ) as CountRow[];
    consumedIgnored = Number(consumedRows[0]?.count || 0);

    const rows = await sql.query(
      `WITH incoming(mailbox) AS (VALUES ${placeholders})
       INSERT INTO ${tableName} (mailbox)
       SELECT mailbox
       FROM incoming
       WHERE NOT EXISTS (
         SELECT 1 FROM ${consumedTableName} consumed
         WHERE consumed.mailbox_key = LOWER(TRIM(SPLIT_PART(incoming.mailbox, '----', 1)))
       )
       ON CONFLICT DO NOTHING
       RETURNING mailbox`,
      mailboxes,
    ) as MailboxRow[];
    added = rows.length;
  }

  const existingIgnored = mailboxes.length - added - consumedIgnored;
  const totalIgnored = ignored + Math.max(0, existingIgnored) + consumedIgnored;
  const count = await countMailboxes();
  return { added, ignored: totalIgnored, existingIgnored: Math.max(0, existingIgnored), consumedIgnored, count };
}

export async function popMailbox() {
  const sql = await ensureTable();
  const rows = await sql.query(`
    WITH picked AS (
      SELECT id
      FROM ${tableName}
      ORDER BY id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ), deleted AS (
      DELETE FROM ${tableName}
      USING picked
      WHERE ${tableName}.id = picked.id
      RETURNING ${tableName}.mailbox
    ), remembered AS (
      INSERT INTO ${consumedTableName} (mailbox_key, mailbox)
      SELECT LOWER(TRIM(SPLIT_PART(mailbox, '----', 1))), mailbox
      FROM deleted
      ON CONFLICT (mailbox_key) DO UPDATE SET mailbox = EXCLUDED.mailbox, consumed_at = NOW()
      RETURNING mailbox
    )
    SELECT mailbox FROM deleted
  `) as MailboxRow[];

  const mailbox = rows[0]?.mailbox || null;
  const count = await countMailboxes();
  return { mailbox, count };
}

export async function countMailboxes() {
  const sql = await ensureTable();
  const rows = await sql.query(`SELECT COUNT(*) AS count FROM ${tableName}`) as CountRow[];
  return Number(rows[0]?.count || 0);
}
