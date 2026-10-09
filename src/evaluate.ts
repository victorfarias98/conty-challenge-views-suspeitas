import { type Classification, classify } from "./classifier.ts";
import { CATEGORIES, type Category, type Label, type Series } from "./dataset.ts";

type Counts = Record<Classification, number>;

export type Metrics = {
  legitimate_total: number;
  suspicious_total: number;
  // Série legítima classificada como suspeita, sobre o total de legítimas. É o número que o README publica.
  false_positive_rate: number;
  false_positives: number;
  // Série legítima em que o classificador preferiu não dar veredito.
  legitimate_inconclusive: number;
  // Série suspeita classificada como suspeita, sobre o total de suspeitas.
  recall: number;
  by_category: Array<{ category: Category; label: Label; total: number } & Counts>;
};

export const METRICS_START = "<!-- metrics:start -->";
export const METRICS_END = "<!-- metrics:end -->";

export function evaluate(dataset: Series[]): Metrics {
  const byCategory = (Object.keys(CATEGORIES) as Category[]).map((category) => {
    const counts: Counts = { legitimate: 0, suspicious: 0, inconclusive: 0 };
    const series = dataset.filter((entry) => entry.category === category);
    for (const entry of series) counts[classify(entry.views).classification] += 1;
    return { category, label: CATEGORIES[category].label, total: series.length, ...counts };
  });
  const sum = (label: Label, field: "total" | Classification): number =>
    byCategory.filter((row) => row.label === label).reduce((total, row) => total + row[field], 0);
  const legitimateTotal = sum("legitimate", "total");
  const suspiciousTotal = sum("suspicious", "total");
  const falsePositives = sum("legitimate", "suspicious");
  return {
    legitimate_total: legitimateTotal,
    suspicious_total: suspiciousTotal,
    false_positive_rate: falsePositives / legitimateTotal,
    false_positives: falsePositives,
    legitimate_inconclusive: sum("legitimate", "inconclusive"),
    recall: sum("suspicious", "suspicious") / suspiciousTotal,
    by_category: byCategory,
  };
}

export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1).replace(".", ",")}%`;
}

// O trecho do README entre os marcadores. O teste compara este texto com o que está no arquivo.
export function renderMetrics(metrics: Metrics): string {
  const rows = metrics.by_category.map(
    (row) =>
      `| \`${row.category}\` | ${row.label === "legitimate" ? "legítima" : "suspeita"} | ${row.total} | ${row.legitimate} | ${row.inconclusive} | ${row.suspicious} |`,
  );
  return [
    `**Taxa de falso positivo: ${formatRate(metrics.false_positive_rate)}** (${metrics.false_positives} de ${metrics.legitimate_total} séries legítimas classificadas como suspeitas).`,
    "",
    `- Legítimas sem veredito: ${metrics.legitimate_inconclusive} de ${metrics.legitimate_total} (${formatRate(metrics.legitimate_inconclusive / metrics.legitimate_total)}).`,
    `- Suspeitas detectadas: ${formatRate(metrics.recall)} de ${metrics.suspicious_total}.`,
    "",
    "| Tipo de série | Rótulo | Total | Classificada legítima | Sem veredito | Classificada suspeita |",
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

export function replaceMetricsBlock(readme: string, block: string): string {
  const start = readme.indexOf(METRICS_START);
  const end = readme.indexOf(METRICS_END);
  if (start === -1 || end === -1 || end < start) throw new Error("marcadores de métricas não encontrados no README");
  return `${readme.slice(0, start + METRICS_START.length)}\n${block}\n${readme.slice(end)}`;
}

export function readMetricsBlock(readme: string): string {
  const start = readme.indexOf(METRICS_START);
  const end = readme.indexOf(METRICS_END);
  return start === -1 || end === -1 ? "" : readme.slice(start + METRICS_START.length, end).trim();
}
