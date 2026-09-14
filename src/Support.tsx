import { useEffect, useState } from 'react';
import { Dialog } from './components/ui/dialog';
import { request } from './api';
import './functional.css';

type Ticket = { id: string; text: string; createdAt: string; status: string; replies?: { text: string; createdAt?: string }[]; reply?: string; repliedAt?: string };

export default function Support({ onClose }: { onClose: () => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function refresh(signal?: AbortSignal) {
    setLoading(true); setError('');
    try {
      const result = await request<{ tickets: Ticket[] }>('/api/support', { signal });
      if (!signal?.aborted) setTickets(result.tickets);
    } catch (problem) {
      if (!signal?.aborted) setError(problem instanceof Error ? problem.message : 'Не удалось загрузить обращения.');
    } finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, []);

  async function send() {
    if (sending || loading || !text.trim()) return;
    setSending(true); setError(''); setNotice('');
    try {
      const { ticket } = await request<{ ticket: Ticket }>('/api/support', { method: 'POST', body: JSON.stringify({ text: text.trim() }) });
      setTickets(current => [ticket, ...current]); setText(''); setNotice('Обращение отправлено.');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Не удалось отправить обращение.');
    } finally { setSending(false); }
  }

  return <Dialog open onClose={onClose} title="Поддержка SCENZA" closeLabel="Закрыть поддержку" className="support-dialog">
    <h2>Поддержка SCENZA</h2>
    <p className="support-intro">Опишите, что случилось. Ответ появится в этом окне.</p>
    <form onSubmit={event => { event.preventDefault(); void send(); }}>
      <label htmlFor="support-message">Ваше сообщение</label>
      <textarea id="support-message" value={text} onChange={event => setText(event.target.value)} required maxLength={3000} rows={4} disabled={sending} aria-describedby="support-message-note" />
      <small id="support-message-note">До 3000 символов.</small>
      <button className="button primary" type="submit" disabled={sending || loading || !text.trim()} aria-busy={sending}>{sending ? 'Отправляем…' : 'Отправить'}</button>
    </form>
    {error && <p className="support-error" role="alert">{error}</p>}
    <p className="support-notice" role="status">{notice}</p>
    <div className="support-list-heading"><h3>Мои обращения</h3><button className="button outline" disabled={loading || sending} onClick={() => void refresh()}>{loading ? 'Загружаем…' : 'Обновить'}</button></div>
    {loading && <p role="status">Загружаем обращения…</p>}
    {!loading && !error && !tickets.length && <p>У вас пока нет обращений.</p>}
    <ul className="support-tickets">{tickets.map(ticket => {
      const replies = ticket.replies ?? (ticket.reply ? [{ text: ticket.reply, createdAt: ticket.repliedAt }] : []);
      return <li key={ticket.id}>
      <div className="support-ticket-meta"><time dateTime={ticket.createdAt}>{new Date(ticket.createdAt).toLocaleString('ru-RU')}</time><span>{ticket.status === 'closed' ? 'Закрыто' : ticket.status === 'answered' || replies.length ? 'Есть ответ' : ticket.status === 'new' ? 'Новое обращение' : 'Ожидает ответа'}</span></div>
      <p>{ticket.text}</p>
      {replies.map((reply, index) => <div className="support-reply" key={index}><strong>Ответ поддержки</strong><p>{reply.text}</p>{reply.createdAt && <time dateTime={reply.createdAt}>{new Date(reply.createdAt).toLocaleString('ru-RU')}</time>}</div>)}
    </li>; })}</ul>
  </Dialog>;
}
