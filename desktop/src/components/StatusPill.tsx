type Status = 'idle' | 'recording' | 'uploading' | 'transcribing' | 'done' | 'error';

const labels: Record<Status, string> = {
  idle: 'Ready',
  recording: 'Recording',
  uploading: 'Uploading',
  transcribing: 'Transcribing',
  done: 'Done',
  error: 'Error',
};

const colors: Record<Status, string> = {
  idle: 'bg-muted/20 text-muted',
  recording: 'bg-danger/20 text-danger',
  uploading: 'bg-accent/20 text-accent',
  transcribing: 'bg-accent/20 text-accent',
  done: 'bg-accent/10 text-accent',
  error: 'bg-danger/20 text-danger',
};

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${colors[status]}`}>
      {status === 'recording' && (
        <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
      )}
      {labels[status]}
    </span>
  );
}
