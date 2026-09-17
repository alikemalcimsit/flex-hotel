/**
 * Liste ekranlarının üstündeki filtre şeridi: solda arama/filtre alanları,
 * sağda ekranın ana eylemi ("Yeni …"). Dar ekranda eylem alanların altına iner.
 *
 * @param {{ children: React.ReactNode, actions?: React.ReactNode }} props
 */
export function Toolbar({ children, actions }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 rounded-card bg-surface p-5 shadow-card">
      <div className="flex w-full flex-wrap items-end gap-3 sm:w-auto">{children}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
