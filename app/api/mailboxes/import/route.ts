import { importMailboxes, requireAdminToken } from '@/lib/pool';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const unauthorized = requireAdminToken(request);
  if (unauthorized) return unauthorized;

  const contentType = request.headers.get('content-type') || '';
  let text = '';

  if (contentType.includes('application/json')) {
    const body = (await request.json()) as { text?: string };
    text = String(body.text || '');
  } else {
    text = await request.text();
  }

  const result = await importMailboxes(text);
  return Response.json({ ok: true, ...result });
}
