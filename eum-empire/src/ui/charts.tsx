// 간단한 SVG 차트(실제 시뮬레이션 데이터만 받음)
import { formatWon } from './format';

export interface Series { name: string; color: string; values: number[] }

export function LineChart({ series, labels, height = 160, money = true }: { series: Series[]; labels: string[]; height?: number; money?: boolean }) {
  const W = 900, H = height, P = { l: 70, r: 40, t: 10, b: 22 };
  const all = series.flatMap((s) => s.values);
  if (!all.length) return <div className="empty">아직 데이터가 없습니다</div>;
  let min = Math.min(0, ...all), max = Math.max(0, ...all);
  if (max === min) max = min + 1;
  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i: number) => P.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - P.l - P.r));
  const y = (v: number) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  const ticks = [min, (min + max) / 2, max];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className="grid" />
          <text x={P.l - 4} y={y(t) + 4} textAnchor="end" className="axis">{money ? formatWon(Math.round(t)) : Math.round(t).toLocaleString()}</text>
        </g>
      ))}
      {min < 0 && <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} className="zero" />}
      {labels.map((l, i) => (n <= 12 || i % Math.ceil(n / 12) === 0) && <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="axis">{l}</text>)}
      {series.map((s) => (
        <g key={s.name}>
          <polyline fill="none" stroke={s.color} strokeWidth={2} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
          {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.color}><title>{`${s.name} ${labels[i] ?? ''}: ${money ? formatWon(v) : v.toLocaleString()}`}</title></circle>)}
        </g>
      ))}
    </svg>
  );
}

export function Legend({ series }: { series: { name: string; color: string }[] }) {
  return <div className="legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>;
}

export function ShareBar({ parts }: { parts: { name: string; color: string; value: number }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return <div className="empty">판매 기록 없음</div>;
  return (
    <div className="sharebar">
      {parts.filter((p) => p.value > 0).map((p) => (
        <div key={p.name} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.name} ${((p.value / total) * 100).toFixed(1)}%`}>
          {p.value / total > 0.09 ? `${p.name} ${((p.value / total) * 100).toFixed(0)}%` : ''}
        </div>
      ))}
    </div>
  );
}
