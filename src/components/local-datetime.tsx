"use client";

import { useEffect, useState } from "react";

type Props = {
  /** ISO-8601 / Date-serializable instant from the server */
  value: string | Date;
  /** Optional Intl options; defaults to locale date + time with timezone. */
  options?: Intl.DateTimeFormatOptions;
  className?: string;
};

const DEFAULT_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

/**
 * Renders an instant in the browser's local timezone + locale.
 * Shows a stable ISO fallback until mounted to avoid hydration mismatch.
 */
export function LocalDateTime({ value, options, className }: Props) {
  const date = value instanceof Date ? value : new Date(value);
  const iso = Number.isNaN(date.getTime()) ? "" : date.toISOString();
  const [label, setLabel] = useState(iso);

  useEffect(() => {
    if (!iso) {
      setLabel("—");
      return;
    }
    setLabel(
      new Intl.DateTimeFormat(undefined, options ?? DEFAULT_OPTIONS).format(
        new Date(iso),
      ),
    );
  }, [iso, options]);

  if (!iso) return <span className={className}>—</span>;

  return (
    <time dateTime={iso} className={className} title={iso}>
      {label}
    </time>
  );
}
