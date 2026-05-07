import { popMailbox } from '@/lib/pool';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { mailbox, count } = await popMailbox();
  if (!mailbox) {
    return Response.json({ ok: false, mailbox: null, count, error: 'empty' }, { status: 404 });
  }
  return Response.json({ ok: true, mailbox, count });
}

export async function POST() {
  return GET();
}
