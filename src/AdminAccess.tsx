import { Film } from 'lucide-react';
import { Dialog } from './components/ui/dialog';
import { adminAccessCopy, adminContactUrl } from './landing/plans';
import './functional.css';

/** The pricing section's "access through the administrator" notice, inside the studio. Closing it keeps the current page. */
export default function AdminAccess({ open, onClose }: { open: boolean; onClose: () => void }) {
  const notice = adminAccessCopy('ru');
  return <Dialog open={open} onClose={onClose} title={notice.title} closeLabel="Закрыть" className="support-dialog admin-access-dialog">
    <Film size={29} aria-hidden="true" /><h2>{notice.title}</h2><p className="support-intro">{notice.text}</p>
    <a className="button primary" href={adminContactUrl} target="_blank" rel="noopener noreferrer">{notice.action}</a>
  </Dialog>;
}
