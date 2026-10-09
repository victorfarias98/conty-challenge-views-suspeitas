// Classificador explicável para uma série de views por hora. Sem modelo: três medidas simples,
// cada uma com um limiar, e uma regra de decisão que cabe em três linhas.

export type Classification = "legitimate" | "suspicious" | "inconclusive";
export type SignalName = "sudden_onset" | "abrupt_drop" | "mechanical_repetition";

export type Signal = {
  name: SignalName;
  triggered: boolean;
  // 0 não disparou, 1 disparou, 2 disparou forte o bastante para acusar sozinho.
  weight: 0 | 1 | 2;
  value: number;
  threshold: number;
  // Hora da série (começando em 0) em que o sinal foi medido.
  hour: number | null;
  explanation: string;
};

export type Verdict = {
  classification: Classification;
  reason: string;
  score: number;
  signals: Signal[];
  hours: number;
  total_views: number;
};

export const THRESHOLDS = {
  // Com menos horas que isso não dá para separar ritmo de ruído.
  minHours: 24,
  // Subida: views de uma hora divididas pelas da hora anterior.
  onsetFactor: 10,
  // A subida só conta se chegar a este volume, e a hora anterior nunca é tratada como menor que o piso.
  onsetMinViews: 500,
  onsetFloor: 20,
  // Queda: fração das views perdida de uma hora para a seguinte.
  dropRatio: 0.8,
  dropMinViews: 500,
  // Repetição: horas seguidas cujo número difere da hora anterior em até esta fração.
  flatTolerance: 0.01,
  flatMinViews: 100,
  flatRunHours: 6,
  flatRunStrongHours: 12,
} as const;

// Por que cada sinal, sozinho, não basta para acusar.
const INNOCENT_EXPLANATION: Record<SignalName, string> = {
  sudden_onset: "um perfil grande pode ter compartilhado o post",
  abrupt_drop: "o post pode ter sido removido ou a plataforma pode ter parado de distribuí-lo",
  mechanical_repetition: "poucas horas parecidas podem ser coincidência",
};

function decimal(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function suddenOnset(views: number[]): Signal {
  let best = { factor: 0, hour: null as number | null, from: 0, to: 0 };
  for (let hour = 1; hour < views.length; hour += 1) {
    const from = views[hour - 1] ?? 0;
    const to = views[hour] ?? 0;
    if (to < THRESHOLDS.onsetMinViews) continue;
    const factor = to / Math.max(from, THRESHOLDS.onsetFloor);
    if (factor > best.factor) best = { factor, hour, from, to };
  }
  const triggered = best.factor >= THRESHOLDS.onsetFactor;
  return {
    name: "sudden_onset",
    triggered,
    weight: triggered ? 1 : 0,
    value: Number(best.factor.toFixed(2)),
    threshold: THRESHOLDS.onsetFactor,
    hour: best.hour,
    explanation: triggered
      ? `as views subiram ${decimal(best.factor)} vezes em uma hora (de ${best.from} para ${best.to}, na hora ${best.hour})`
      : `a subida mais forte em uma hora foi de ${decimal(best.factor)} vezes`,
  };
}

function abruptDrop(views: number[]): Signal {
  let best = { ratio: 0, hour: null as number | null, from: 0, to: 0 };
  for (let hour = 1; hour < views.length; hour += 1) {
    const from = views[hour - 1] ?? 0;
    const to = views[hour] ?? 0;
    if (from < THRESHOLDS.dropMinViews) continue;
    const ratio = (from - to) / from;
    if (ratio > best.ratio) best = { ratio, hour, from, to };
  }
  const triggered = best.ratio >= THRESHOLDS.dropRatio;
  return {
    name: "abrupt_drop",
    triggered,
    weight: triggered ? 1 : 0,
    value: Number(best.ratio.toFixed(3)),
    threshold: THRESHOLDS.dropRatio,
    hour: best.hour,
    explanation: triggered
      ? `as views caíram ${percent(best.ratio)} em uma hora (de ${best.from} para ${best.to}, na hora ${best.hour})`
      : `a maior queda em uma hora foi de ${percent(best.ratio)}`,
  };
}

function mechanicalRepetition(views: number[]): Signal {
  let best = { hours: 1, start: null as number | null };
  let run = 1;
  for (let hour = 1; hour < views.length; hour += 1) {
    const from = views[hour - 1] ?? 0;
    const to = views[hour] ?? 0;
    const flat =
      from >= THRESHOLDS.flatMinViews &&
      to >= THRESHOLDS.flatMinViews &&
      Math.abs(to - from) <= THRESHOLDS.flatTolerance * from;
    run = flat ? run + 1 : 1;
    if (run > best.hours) best = { hours: run, start: hour - run + 1 };
  }
  const triggered = best.hours >= THRESHOLDS.flatRunHours;
  return {
    name: "mechanical_repetition",
    triggered,
    weight: best.hours >= THRESHOLDS.flatRunStrongHours ? 2 : triggered ? 1 : 0,
    value: best.hours,
    threshold: THRESHOLDS.flatRunHours,
    hour: triggered ? best.start : null,
    explanation: triggered
      ? `${best.hours} horas seguidas com praticamente o mesmo número de views (até ${percent(THRESHOLDS.flatTolerance)} de diferença entre uma hora e a seguinte, a partir da hora ${best.start})`
      : `a maior sequência de horas com o mesmo número de views foi de ${best.hours}`,
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Decisão:
//   soma dos pesos >= 2  -> suspicious
//   soma dos pesos == 1  -> inconclusive (um sinal isolado tem explicação inocente; não acusa)
//   soma dos pesos == 0  -> legitimate
// Série com menos de minHours horas é sempre inconclusive.
export function classify(views: number[]): Verdict {
  const signals = [suddenOnset(views), abruptDrop(views), mechanicalRepetition(views)];
  const triggered = signals.filter((signal) => signal.triggered);
  const score = signals.reduce((sum, signal) => sum + signal.weight, 0);
  const base = { score, signals, hours: views.length, total_views: views.reduce((sum, value) => sum + value, 0) };

  if (views.length < THRESHOLDS.minHours) {
    return {
      ...base,
      classification: "inconclusive",
      reason: `Sem veredito: a série tem ${views.length} horas e são necessárias pelo menos ${THRESHOLDS.minHours} para avaliar.`,
    };
  }
  if (score >= 2) {
    const evidence = triggered.map((signal) => signal.explanation).join("; e ");
    return {
      ...base,
      classification: "suspicious",
      reason: `Padrão incompatível com audiência humana: ${evidence}. Gente de verdade chega e vai embora aos poucos, e nunca no mesmo número hora após hora.`,
    };
  }
  const only = triggered[0];
  if (only) {
    return {
      ...base,
      classification: "inconclusive",
      reason: `Sem veredito: ${only.explanation}, mas esse foi o único sinal e ${INNOCENT_EXPLANATION[only.name]}. Um sinal isolado não basta para acusar.`,
    };
  }
  return {
    ...base,
    classification: "legitimate",
    reason: `Nenhum padrão incompatível com audiência humana. ${capitalize(signals.map((signal) => signal.explanation).join("; "))}.`,
  };
}
