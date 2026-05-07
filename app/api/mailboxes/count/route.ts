import { countMailboxes } from '@/lib/pool';

export const dynamic = 'force-dynamic';

export async function GET() {
  const count = await countMailboxes();
  return Response.json({ ok: true, count });
}
