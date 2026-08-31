/** Banner de borrador legal: solo en entornos no productivos. */
export function LegalDraftNotice({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  if (process.env.NODE_ENV === 'production') return null;
  return (
    <div className={className} role="note">
      {children}
    </div>
  );
}
