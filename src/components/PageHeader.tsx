import type { ReactNode } from "react";

/** Cabeçalho padrão das páginas: eyebrow em tinta sólida + título com marca-texto. */
export default function PageHeader({ eyebrow, title, sub, aside, className = "" }: {
  eyebrow: string;
  title: string;
  sub?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-end gap-x-4 gap-y-2 ${className}`}>
      <div>
        <p className="flim-nav text-[#141414]">{eyebrow}</p>
        <h1 className="mt-1 text-[32px] font-bold leading-none text-[#141414]">
          <span className="inline-block rounded-[25px] bg-[#fecc33] px-3 pb-1">{title}</span>
        </h1>
        {sub && <p className="mt-1.5 text-sm text-[#141414]">{sub}</p>}
      </div>
      {aside && <div className="ml-auto">{aside}</div>}
    </div>
  );
}
