// A minimal metrics registry in Prometheus text format (OBS-02), served on its own port.

type Labels = Record<string, string>;

const key = (labels: Labels) => Object.keys(labels).sort().map((k) => `${k}="${labels[k]!.replace(/["\\\n]/g, '_')}"`).join(',');

export interface Metrics {
  counter(name: string, help: string, labelNames?: string[]): { inc(labels?: Labels, by?: number): void };
  histogram(name: string, help: string, labelNames?: string[], buckets?: number[]): { observe(labels: Labels, value: number): void };
  gauge(name: string, help: string, read: () => number): void;
  render(): string;
}

export function createMetrics(): Metrics {
  const blocks: (() => string[])[] = [];
  return {
    counter(name, help) {
      const values = new Map<string, number>();
      blocks.push(() => [`# HELP ${name} ${help}`, `# TYPE ${name} counter`, ...[...values].map(([k, v]) => `${name}${k ? `{${k}}` : ''} ${v}`)]);
      return { inc: (labels = {}, by = 1) => values.set(key(labels), (values.get(key(labels)) ?? 0) + by) };
    },
    histogram(name, help, _labelNames, buckets = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]) {
      const series = new Map<string, { counts: number[]; sum: number; count: number }>();
      blocks.push(() => {
        const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
        for (const [k, s] of series) {
          const sep = k ? ',' : '';
          buckets.forEach((b, i) => lines.push(`${name}_bucket{${k}${sep}le="${b}"} ${s.counts[i]}`));
          lines.push(`${name}_bucket{${k}${sep}le="+Inf"} ${s.count}`, `${name}_sum${k ? `{${k}}` : ''} ${s.sum}`, `${name}_count${k ? `{${k}}` : ''} ${s.count}`);
        }
        return lines;
      });
      return {
        observe(labels, value) {
          const s = series.get(key(labels)) ?? { counts: buckets.map(() => 0), sum: 0, count: 0 };
          buckets.forEach((b, i) => { if (value <= b) s.counts[i]!++; });
          s.sum += value;
          s.count++;
          series.set(key(labels), s);
        },
      };
    },
    gauge(name, help, read) {
      blocks.push(() => [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${read()}`]);
    },
    render: () => blocks.flatMap((b) => b()).join('\n') + '\n',
  };
}
