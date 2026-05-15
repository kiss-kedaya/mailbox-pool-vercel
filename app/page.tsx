'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';

const importChunkMaxLines = 1000;
const importChunkMaxChars = 250_000;

async function readJsonOrThrow(res: Response) {
  const raw = await res.text();
  let data: Record<string, any> = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    if (!res.ok) throw new Error(raw || res.statusText);
    throw new Error(`invalid json response: ${raw.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(String(data.error || raw || res.statusText));
  return data;
}

function splitImportText(value: string) {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const nextChars = line.length + 1;
    if (current.length > 0 && (current.length >= importChunkMaxLines || currentChars + nextChars > importChunkMaxChars)) {
      chunks.push(current.join('\n'));
      current = [];
      currentChars = 0;
    }
    current.push(line);
    currentChars += nextChars;
  }

  if (current.length > 0) chunks.push(current.join('\n'));
  return chunks;
}

export default function Home() {
  const [text, setText] = useState('');
  const [token, setToken] = useState('');
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'bad'; text: string } | null>(null);

  const lineCount = useMemo(() => text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).length, [text]);

  async function refreshCount() {
    const res = await fetch('/api/mailboxes/count', { cache: 'no-store' });
    const data = await res.json();
    if (typeof data.count === 'number') setCount(data.count);
  }

  useEffect(() => {
    refreshCount().catch(() => undefined);
    const timer = window.setInterval(() => refreshCount().catch(() => undefined), 1500);
    return () => window.clearInterval(timer);
  }, []);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setText(await file.text());
  }

  async function importText() {
    setLoading(true);
    setMessage(null);
    try {
      const chunks = splitImportText(text);
      if (chunks.length === 0) return;

      let added = 0;
      let ignored = 0;
      let existingIgnored = 0;
      let consumedIgnored = 0;
      let latestCount = count;

      for (let index = 0; index < chunks.length; index += 1) {
        setMessage({ type: 'ok', text: `正在分批导入：${index + 1}/${chunks.length}` });
        const res = await fetch('/api/mailboxes/import', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { 'x-admin-token': token } : {}),
          },
          body: JSON.stringify({ text: chunks[index] }),
        });
        const data = await readJsonOrThrow(res);
        added += Number(data.added || 0);
        ignored += Number(data.ignored || 0);
        existingIgnored += Number(data.existingIgnored || 0);
        consumedIgnored += Number(data.consumedIgnored || 0);
        latestCount = Number(data.count || latestCount || 0);
        setCount(latestCount);
      }

      setMessage({ type: 'ok', text: `导入成功：分 ${chunks.length} 批，新增 ${added} 行，忽略重复 ${ignored} 行（其中数据库已有 ${existingIgnored} 行，历史已取 ${consumedIgnored} 行），当前在线 ${latestCount} 个` });
    } catch (error) {
      setMessage({ type: 'bad', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function getOne() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/mailboxes/next', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          ...(token ? { 'x-admin-token': token } : {}),
        },
      });
      const data = await res.json();
      setCount(data.count || 0);
      if (!res.ok) throw new Error(data.error || 'empty');
      setMessage({ type: 'ok', text: `取出：${data.mailbox}` });
    } catch (error) {
      setMessage({ type: 'bad', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Mailbox Pool</h1>
      <p>集中管理邮箱库存，多服务器直接请求 API 领取一个邮箱，避免每台机器单独维护 txt。</p>

      <section className="card">
        <div className="row">
          <div className="stat">
            <span>在线邮箱数</span>
            <strong>{count}</strong>
          </div>
          <button className="secondary" onClick={refreshCount} disabled={loading}>刷新</button>
          <button className="secondary" onClick={getOne} disabled={loading}>测试取一个</button>
        </div>
      </section>

      <section className="card">
        <h2>导入邮箱 TXT</h2>
        <p>支持上传 txt 或直接粘贴，一行一个。页面每 1.5 秒刷新在线邮箱数。</p>
        <div className="row">
          <input type="file" accept=".txt,text/plain" onChange={onFileChange} />
        </div>
        <p>Admin Token（如果 Vercel 配了 ADMIN_TOKEN，导入和取出时都需要填）：</p>
        <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="ADMIN_TOKEN" />
        <p>待导入行数：{lineCount}</p>
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="mail1@example.com\nmail2@example.com" />
        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={importText} disabled={loading || !text.trim()}>导入</button>
          <button className="secondary" onClick={() => setText('')} disabled={loading}>清空输入框</button>
        </div>
        {message && <p className={`msg ${message.type}`}>{message.text}</p>}
      </section>

      <section className="card">
        <h2>服务器领取接口</h2>
        <div className="code">{`GET /api/mailboxes/next\nAuthorization: Bearer <ADMIN_TOKEN>`}</div>
        <p>成功返回：</p>
        <div className="code">{`{ "ok": true, "mailbox": "mail@example.com", "count": 123 }`}</div>
        <p>导入接口：</p>
        <div className="code">{`POST /api/mailboxes/import\nAuthorization: Bearer <ADMIN_TOKEN>\n{ "text": "a@example.com\\nb@example.com" }`}</div>
      </section>
    </main>
  );
}
