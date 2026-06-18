export default function StatCard({ label, value }) {
  return (
    <section className="statCard">
      <span>{label}</span>
      <strong>{value ?? 0}</strong>
    </section>
  );
}
