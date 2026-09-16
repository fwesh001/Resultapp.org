interface PageHeroProps {
  title: string;
  subtitle?: string;
}

export function PageHero({ title, subtitle }: PageHeroProps) {
  return (
    <div className="relative h-64 w-full overflow-hidden">
      <img src="/bento-csv-accent.avif" alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0B0514] via-[#0B0514]/80 to-transparent" />
      <div className="absolute inset-0 bg-violet-950/20 mix-blend-multiply" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(147,51,234,0.15),transparent_70%)]" />
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-purple-50 md:text-4xl lg:text-5xl drop-shadow-[0_2px_16px_rgba(0,0,0,0.5)]">
          {title}
        </h1>
        {subtitle && <p className="mt-3 max-w-2xl text-sm leading-6 text-purple-200/70 md:text-base">{subtitle}</p>}
      </div>
    </div>
  );
}
