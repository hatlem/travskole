'use client';

interface PaginationProps {
  total: number;
  page: number;
  perPage: number;
  onChange: (page: number) => void;
}

const ACTIVE_COLOR = 'var(--bjerke-blue)';

const getPageNumbers = (current: number, total: number): (number | 'ellipsis')[] => {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | 'ellipsis')[] = [1];

  if (current > 3) {
    pages.push('ellipsis');
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push('ellipsis');
  }

  pages.push(total);

  return pages;
};

export const Pagination = ({ total, page, perPage, onChange }: PaginationProps) => {
  const totalPages = Math.ceil(total / perPage);
  if (totalPages <= 1) return null;

  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);
  const pages = getPageNumbers(page, totalPages);

  const buttonBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 36,
    height: 36,
    padding: '0 10px',
    borderRadius: 6,
    border: '1px solid #d1d5db',
    backgroundColor: '#fff',
    color: '#374151',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
  };

  const disabledStyle: React.CSSProperties = {
    opacity: 0.4,
    cursor: 'not-allowed',
  };

  const activeStyle: React.CSSProperties = {
    backgroundColor: ACTIVE_COLOR,
    color: '#fff',
    borderColor: ACTIVE_COLOR,
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        padding: '12px 0',
      }}
    >
      <span style={{ fontSize: 14, color: '#6b7280' }}>
        Viser {start}&ndash;{end} av {total}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          style={{
            ...buttonBase,
            ...(page <= 1 ? disabledStyle : {}),
          }}
          aria-label="Forrige side"
        >
          &lsaquo; <span className="pagination-label">Forrige</span>
        </button>

        {pages.map((p, i) =>
          p === 'ellipsis' ? (
            <span
              key={`ellipsis-${i}`}
              style={{ padding: '0 4px', color: '#9ca3af', fontSize: 14 }}
            >
              &hellip;
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onChange(p)}
              style={{
                ...buttonBase,
                ...(p === page ? activeStyle : {}),
              }}
              aria-current={p === page ? 'page' : undefined}
              className="pagination-page-btn"
            >
              {p}
            </button>
          ),
        )}

        <button
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          style={{
            ...buttonBase,
            ...(page >= totalPages ? disabledStyle : {}),
          }}
          aria-label="Neste side"
        >
          <span className="pagination-label">Neste</span> &rsaquo;
        </button>
      </div>

      <style jsx global>{`
        @media (max-width: 640px) {
          .pagination-label {
            display: none;
          }
          .pagination-page-btn {
            min-width: 32px !important;
            height: 32px !important;
            padding: 0 6px !important;
            font-size: 13px !important;
          }
        }
      `}</style>
    </div>
  );
};
