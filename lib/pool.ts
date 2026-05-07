import { neon } from '@neondatabase/serverless';

const tableName = 'mailbox_pool_items';

type MailboxRow = {
  mailbox: string;
};

type CountRow = {
  count: string | number;
};

export type ImportResult = {
  added: number;
  ignored: number;
  count: number;
};

function getSql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }
  return neon(databaseUrl);
}

async function ensureTable() {
  const sql = getSql();
  await sql.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id BIGSERIAL PRIMARY KEY,
      mailbox TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  return sql;
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
    if (seen.has(line)) {
      ignored += 1;
      continue;
    }
    seen.add(line);
    mailboxes.push(line);
  }

  return { mailboxes, ignored };
}

export async function importMailboxes(text: string): Promise<ImportResult> {
  const { mailboxes, ignored } = parseMailboxText(text);
  const sql = await ensureTable();

  if (mailboxes.length > 0) {
    const placeholders = mailboxes.map((_, index) => `($${index + 1})`).join(',');
    await sql.query(`INSERT INTO ${tableName} (mailbox) VALUES ${placeholders}`, mailboxes);
  }

  const count = await countMailboxes();
  return { added: mailboxes.length, ignored, count };
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
    )
    DELETE FROM ${tableName}
    USING picked
    WHERE ${tableName}.id = picked.id
    RETURNING ${tableName}.mailbox
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
