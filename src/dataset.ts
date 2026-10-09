// Gerador do conjunto sintético. Tudo sai de uma semente fixa: rodar de novo gera as mesmas séries.

export const DATASET_SEED = 20260313;
export const HOURS = 96;

export type Label = "legitimate" | "suspicious";

// Quantas séries de cada tipo, e o que cada tipo representa.
export const CATEGORIES = {
  organic_steady: { label: "legitimate", count: 80, description: "audiência normal: ciclo de dia e noite, ruído e queda lenta" },
  organic_viral: { label: "legitimate", count: 80, description: "vídeo que estourou: sobe em 3 a 5 horas e desce aos poucos" },
  organic_small: { label: "legitimate", count: 30, description: "perfil pequeno, poucas dezenas de views por hora" },
  organic_reshare: { label: "legitimate", count: 24, description: "perfil grande compartilhou: salto em uma hora, queda lenta depois" },
  organic_removed: { label: "legitimate", count: 10, description: "post removido: audiência normal que some de uma hora para outra" },
  organic_flash: { label: "legitimate", count: 6, description: "menção ao vivo ou push: salto e queda em uma ou duas horas, com gente de verdade" },
  bought_spike: { label: "suspicious", count: 60, description: "pico comprado: salto, patamar reto por 2 a 8 horas e volta ao que era" },
  bot_drip: { label: "suspicious", count: 40, description: "entrega mecânica: o mesmo volume somado por 14 a 40 horas seguidas" },
  bot_ramped: { label: "suspicious", count: 20, description: "robô disfarçado: sobe e desce aos poucos, com ruído, imitando gente" },
} as const satisfies Record<string, { label: Label; count: number; description: string }>;

export type Category = keyof typeof CATEGORIES;
export type Series = { id: string; category: Category; label: Label; views: number[] };

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(rand: Rng, min: number, max: number): number {
  return min + rand() * (max - min);
}

function integerBetween(rand: Rng, min: number, max: number): number {
  return Math.floor(between(rand, min, max + 1));
}

// Ruído multiplicativo lognormal: audiência humana varia em proporção ao próprio tamanho.
function noise(rand: Rng, sigma: number): number {
  const gaussian = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  return Math.exp(sigma * gaussian);
}

// Ciclo de dia e noite, entre 0,3 (madrugada) e 1,0 (pico do dia).
function diurnal(hour: number, phase: number): number {
  return 0.65 + 0.35 * Math.sin((2 * Math.PI * (hour - phase)) / 24);
}

// Audiência humana de base: ciclo diário, queda lenta de interesse e ruído, vezes um multiplicador por hora.
function organic(rand: Rng, base: number, multiplier: (hour: number) => number = () => 1): number[] {
  const phase = between(rand, 0, 24);
  const fade = between(rand, 80, 300);
  return Array.from(
    { length: HOURS },
    (_, hour) => base * diurnal(hour, phase) * Math.exp(-hour / fade) * multiplier(hour) * noise(rand, 0.1),
  );
}

const GENERATORS: Record<Category, (rand: Rng) => number[]> = {
  organic_steady: (rand) => organic(rand, between(rand, 300, 5000)),

  organic_viral: (rand) => {
    const start = integerBetween(rand, 10, 40);
    const rampHours = integerBetween(rand, 3, 5);
    const growth = between(rand, 2, 3.5);
    const decay = between(rand, 0.08, 0.25);
    const peak = growth ** rampHours;
    return organic(rand, between(rand, 100, 800), (hour) => {
      if (hour < start) return 1;
      if (hour < start + rampHours) return growth ** (hour - start + 1);
      return Math.max(1, peak * (1 - decay) ** (hour - start - rampHours + 1));
    });
  },

  organic_small: (rand) => organic(rand, between(rand, 5, 60)),

  organic_reshare: (rand) => {
    const start = integerBetween(rand, 10, 50);
    const jump = between(rand, 14, 35);
    const decay = between(rand, 0.1, 0.25);
    return organic(rand, between(rand, 100, 600), (hour) =>
      hour < start ? 1 : Math.max(1, jump * (1 - decay) ** (hour - start)),
    );
  },

  organic_removed: (rand) => {
    const removedAt = integerBetween(rand, 30, 80);
    return organic(rand, between(rand, 800, 5000), (hour) => (hour < removedAt ? 1 : 0.01));
  },

  organic_flash: (rand) => {
    const start = integerBetween(rand, 12, 70);
    const duration = integerBetween(rand, 1, 2);
    const jump = between(rand, 15, 40);
    return organic(rand, between(rand, 200, 800), (hour) => {
      if (hour < start) return 1;
      return hour < start + duration ? jump : 1.5;
    });
  },

  bought_spike: (rand) => {
    const start = integerBetween(rand, 12, 70);
    const duration = integerBetween(rand, 2, 8);
    const base = between(rand, 50, 400);
    const plateau = base * between(rand, 25, 80);
    const wobble = between(rand, 0.003, 0.02);
    return organic(rand, base).map((value, hour) =>
      hour >= start && hour < start + duration ? plateau * (1 + between(rand, -wobble, wobble)) : value,
    );
  },

  bot_drip: (rand) => {
    const start = integerBetween(rand, 8, 40);
    const duration = integerBetween(rand, 14, 40);
    const delivered = between(rand, 4000, 12000);
    return organic(rand, between(rand, 20, 100)).map((value, hour) =>
      hour >= start && hour < start + duration ? value + delivered : value,
    );
  },

  bot_ramped: (rand) => {
    const start = integerBetween(rand, 8, 40);
    const hold = integerBetween(rand, 6, 10);
    const volume = between(rand, 3000, 10000);
    return organic(rand, between(rand, 100, 500)).map((value, hour) => {
      const elapsed = hour - start;
      if (elapsed < 0) return value;
      const shape = elapsed < 5 ? 2 ** (elapsed - 5) : elapsed < 5 + hold ? 1 : 0.7 ** (elapsed - 5 - hold + 1);
      return value + volume * shape * noise(rand, 0.15);
    });
  },
};

export function generateDataset(seed: number = DATASET_SEED): Series[] {
  const rand = mulberry32(seed);
  return (Object.keys(CATEGORIES) as Category[]).flatMap((category) =>
    Array.from({ length: CATEGORIES[category].count }, (_, index) => ({
      id: `${category}_${String(index + 1).padStart(3, "0")}`,
      category,
      label: CATEGORIES[category].label,
      views: GENERATORS[category](rand).map((value) => Math.max(0, Math.round(value))),
    })),
  );
}

// Uma série por linha, para o arquivo ficar legível em diff.
export function serializeDataset(dataset: Series[]): string {
  return `[\n${dataset.map((series) => JSON.stringify(series)).join(",\n")}\n]\n`;
}
