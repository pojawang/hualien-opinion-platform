const statusText = {
  pending: '待審核',
  approved: '已核准',
  rejected: '已拒絕'
};

export default function StatusBadge({ status }) {
  return <span className={`badge ${status || 'pending'}`}>{statusText[status] || status || '待審核'}</span>;
}
