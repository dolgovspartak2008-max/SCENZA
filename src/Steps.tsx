export default function Steps({ labels, active }: { labels: string[]; active: number }) {
  return <ol className="workflow-steps" aria-label="Этапы работы">{labels.map((label, index) => <li key={label} className={index === active ? 'current' : index < active ? 'complete' : ''} aria-current={index === active ? 'step' : undefined}><span>{index + 1}. {label}</span>{index < labels.length - 1 && <i />}</li>)}</ol>;
}
