// Shared error fallback for sections whose data read failed.

export function SectionError({ what, error }: { what: string; error: string }) {
  return (
    <div class="error">
      <strong>{what}</strong>: data temporarily unavailable
      <div class="error-detail">{error}</div>
    </div>
  );
}
