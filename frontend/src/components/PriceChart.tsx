'use client';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { PricePoint } from '@/lib/api';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Props {
  history: PricePoint[];
  marketAvg?: number | null;
}

export function PriceChart({ history, marketAvg }: Props) {
  if (history.length === 0) {
    return (
      <div className="h-48 flex flex-col items-center justify-center text-zinc-500 border border-dashed border-zinc-800 rounded-xl bg-zinc-950/30">
        <p className="text-sm font-medium">Aucun historique de prix disponible</p>
        <p className="text-xs text-zinc-600 mt-1">Les prix seront enregistrés lors des prochains scrapes.</p>
      </div>
    );
  }

  const data = history.map(p => ({
    date: format(new Date(p.recorded_at), 'dd/MM HH:mm', { locale: fr }),
    price: parseFloat(String(p.price)),
  }));

  return (
    <div className="w-full bg-zinc-950/40 border border-zinc-800/60 p-4 rounded-xl">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: '#71717a' }}
            axisLine={{ stroke: '#27272a' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#71717a' }}
            axisLine={{ stroke: '#27272a' }}
            tickLine={false}
            unit="€"
            width={45}
            domain={['auto', 'auto']}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#18181b',
              borderColor: '#3f3f46',
              borderRadius: '12px',
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
            }}
            labelStyle={{ color: '#a1a1aa', fontSize: '10px', fontWeight: 600, marginBottom: '4px' }}
            itemStyle={{ color: '#6366f1', fontSize: '12px', fontWeight: 'bold' }}
            formatter={(v) => [typeof v === 'number' ? `${v.toFixed(2)}€` : v, 'Prix']}
          />
          {marketAvg && (
            <ReferenceLine
              y={marketAvg}
              stroke="#06b6d4"
              strokeDasharray="4 4"
              label={{
                value: `Moy. Marché ${marketAvg.toFixed(0)}€`,
                position: 'insideTopRight',
                fontSize: 10,
                fill: '#06b6d4',
                fontWeight: 600,
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="price"
            stroke="#6366f1"
            strokeWidth={2.5}
            fillOpacity={1}
            fill="url(#colorPrice)"
            dot={{ r: 3, fill: '#18181b', stroke: '#6366f1', strokeWidth: 1.5 }}
            activeDot={{ r: 5, fill: '#6366f1', stroke: '#fff', strokeWidth: 1 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
