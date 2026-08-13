export default function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-start gap-1 border-b border-border py-12">
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      <p className="text-sm text-text-secondary">{hint}</p>
    </div>
  );
}
