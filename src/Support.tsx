import { useEffect, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { Dialog } from './components/ui/dialog';
import { request } from './api';
import './functional.css';

type Ticket = { id: string; text: string; createdAt: string; status: string; replies?: { text: string; createdAt?: string }[]; reply?: string; repliedAt?: string };
const LIMIT = 3000;
// "27 сен · 18:03"; a reply on the same day as the question shows only the time.
const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const day = (value: string) => { const date = new Date(value); return `${date.getDate()} ${months[date.getMonth()]}`; };
const time = (value: string) => new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const stamp = (value: string, sameDayAs?: string) => sameDayAs && day(value) === day(sameDayAs) ? time(value) : `${day(value)} · ${time(value)}`;
const statusOf = (ticket: Ticket, answered: boolean): [string, string] => ticket.status === 'closed' ? ['closed', 'Закрыто'] : ticket.status === 'answered' || answered ? ['answered', 'Есть ответ'] : ticket.status === 'new' ? ['new', 'Новое'] : ['waiting', 'Ожидает ответа'];

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
    <p className="support-intro">Опишите проблему. Ответ появится здесь.</p>
    <form onSubmit={event => { event.preventDefault(); void send(); }}>
      <label htmlFor="support-message">Новое обращение</label>
      <textarea id="support-message" value={text} onChange={event => setText(event.target.value)} required maxLength={LIMIT} rows={4} disabled={sending} aria-describedby="support-message-note" />
      <small id="support-message-note" className="support-counter" aria-label={`Символов: ${text.length} из ${LIMIT}`}>{text.length} / {LIMIT}</small>
      <button className="button primary" type="submit" disabled={sending || loading || !text.trim()} aria-busy={sending}>{sending ? 'Отправляем…' : <>Отправить<ArrowRight size={20} aria-hidden="true" /></>}</button>
    </form>
    {error && <p className="support-error" role="alert">{error}</p>}
    <p className="support-notice" role="status">{notice}</p>
    <div className="support-list-heading"><h3>Мои обращения</h3><button className="button outline" disabled={loading || sending} onClick={() => void refresh()}><RefreshCw size={17} aria-hidden="true" />{loading ? 'Загружаем…' : 'Обновить'}</button></div>
    {loading && <p role="status">Загружаем обращения…</p>}
    {!loading && !error && !tickets.length && <p>У вас пока нет обращений.</p>}
    <ul className="support-tickets">{tickets.map(ticket => {
      const replies = ticket.replies ?? (ticket.reply ? [{ text: ticket.reply, createdAt: ticket.repliedAt }] : []);
      const [status, label] = statusOf(ticket, replies.length > 0);
      return <li key={ticket.id}>
      <div className="support-ticket-meta"><time dateTime={ticket.createdAt}>{stamp(ticket.createdAt)}</time><span className="support-status" data-status={status}>{label}</span></div>
      <p>{ticket.text}</p>
      {replies.map((reply, index) => <div className="support-reply" key={index}><div><strong>Поддержка</strong>{reply.createdAt && <time dateTime={reply.createdAt}>{stamp(reply.createdAt, ticket.createdAt)}</time>}</div><p>{reply.text}</p></div>)}
    </li>; })}</ul>
  </Dialog>;
}
