export default function StatCard({ label, value, hint, tone = 'teal' }) {
  return (
    <section className={`statCard ${tone}`}>
      <div className="statIcon" aria-hidden="true" />
      <span>{label}</span>
      <strong>{value ?? 0}</strong>
      {hint && <small>{hint}</small>}
    </section>
  );
}
