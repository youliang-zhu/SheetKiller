import React from 'react';

export function SectionBlock({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-[var(--sk-text)]">{title}</h2>
        {description && <p className="mt-1 text-xs leading-5 text-[var(--sk-muted)]">{description}</p>}
      </div>
      {children}
    </section>
  );
}
