import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { THRESHOLDS, type Verdict, classify } from "../src/classifier.ts";

// Oscilação fixa de até 8% para os casos escritos à mão não serem perfeitamente lisos.
const WOBBLE = [1.06, 0.95, 1.02, 0.93, 1.08, 0.97, 1.04, 0.92];

function wobble(values: number[]): number[] {
  return values.map((value, hour) => Math.round(value * (WOBBLE[hour % WOBBLE.length] ?? 1)));
}

function baseline(hours: number, level = 300): number[] {
  return Array.from({ length: hours }, () => level);
}

const PEAK = 20_000;

// Vídeo que estourou de verdade: triplica por quatro horas até o pico e perde 15% por hora depois.
const ORGANIC_PEAK = wobble([
  ...baseline(30),
  900,
  2700,
  8100,
  PEAK,
  ...Array.from({ length: 32 }, (_, hour) => Math.max(300, PEAK * 0.85 ** (hour + 1))),
]);

// Pico comprado com o MESMO pico: salta da base para 20 mil, fica reto cinco horas e volta à base.
const BOUGHT_PEAK = [
  ...wobble(baseline(30)),
  ...[1.004, 0.997, 1.008, 0.995, 1.002].map((factor) => Math.round(PEAK * factor)),
  ...wobble(baseline(31)),
];

function signal(verdict: Verdict, name: string) {
  return verdict.signals.find((entry) => entry.name === name);
}

describe("pico orgânico e pico comprado não caem no mesmo balde", () => {
  it("os dois casos têm o mesmo pico e o mesmo tamanho de série", () => {
    expect(Math.max(...BOUGHT_PEAK)).toBeGreaterThan(PEAK * 0.99);
    expect(Math.max(...ORGANIC_PEAK)).toBeGreaterThan(PEAK * 0.9);
    expect(BOUGHT_PEAK).toHaveLength(ORGANIC_PEAK.length);
  });

  it("o pico orgânico é legítimo: sobe em degraus e desce aos poucos", () => {
    const verdict = classify(ORGANIC_PEAK);
    expect(verdict.classification).toBe("legitimate");
    expect(verdict.score).toBe(0);
    expect(signal(verdict, "sudden_onset")?.value).toBeLessThan(THRESHOLDS.onsetFactor);
    expect(signal(verdict, "abrupt_drop")?.value).toBeLessThan(THRESHOLDS.dropRatio);
  });

  it("o pico comprado é suspeito: salto e queda em uma hora cada", () => {
    const verdict = classify(BOUGHT_PEAK);
    expect(verdict.classification).toBe("suspicious");
    expect(signal(verdict, "sudden_onset")).toMatchObject({ triggered: true, hour: 30 });
    expect(signal(verdict, "abrupt_drop")).toMatchObject({ triggered: true, hour: 35 });
    expect(verdict.reason).toContain("subiram");
    expect(verdict.reason).toContain("caíram");
  });
});

describe("casos óbvios", () => {
  it("audiência estável com oscilação é legítima", () => {
    expect(classify(wobble(baseline(72, 1500))).classification).toBe("legitimate");
  });

  it("o mesmo número de views por 20 horas seguidas é suspeito sozinho", () => {
    const verdict = classify([...wobble(baseline(20, 4000)), ...baseline(20, 5000), ...wobble(baseline(20, 4000))]);
    expect(verdict.classification).toBe("suspicious");
    expect(signal(verdict, "mechanical_repetition")).toMatchObject({ triggered: true, weight: 2, value: 20, hour: 20 });
  });

  it("série com volume baixo demais não dispara nenhum sinal", () => {
    const verdict = classify(Array.from({ length: 48 }, (_, hour) => (hour % 7 === 0 ? 40 : 3)));
    expect(verdict.classification).toBe("legitimate");
    expect(verdict.signals.every((entry) => !entry.triggered)).toBe(true);
  });
});

describe("casos em que o classificador prefere não acusar", () => {
  it("salto em uma hora com queda lenta fica sem veredito: pode ser um compartilhamento", () => {
    const verdict = classify(
      wobble([...baseline(30), ...Array.from({ length: 40 }, (_, hour) => Math.max(300, PEAK * 0.85 ** hour))]),
    );
    expect(verdict.classification).toBe("inconclusive");
    expect(verdict.score).toBe(1);
    expect(signal(verdict, "sudden_onset")?.triggered).toBe(true);
    expect(verdict.reason).toContain("perfil grande");
  });

  it("queda em uma hora sem salto antes fica sem veredito: o post pode ter sido removido", () => {
    const verdict = classify([...wobble(baseline(40, 3000)), ...baseline(30, 20)]);
    expect(verdict.classification).toBe("inconclusive");
    expect(signal(verdict, "abrupt_drop")?.triggered).toBe(true);
    expect(verdict.reason).toContain("removido");
  });

  it("seis horas iguais sem mais nada ficam sem veredito", () => {
    const verdict = classify([...wobble(baseline(30, 4000)), ...baseline(6, 4000), ...wobble(baseline(30, 4000))]);
    expect(verdict.classification).toBe("inconclusive");
    expect(signal(verdict, "mechanical_repetition")).toMatchObject({ triggered: true, weight: 1 });
  });

  it("série com menos de 24 horas fica sem veredito, mesmo com sinais fortes", () => {
    const verdict = classify(BOUGHT_PEAK.slice(25, 40));
    expect(verdict.classification).toBe("inconclusive");
    expect(verdict.reason).toContain("24");
  });
});

describe("motivo e sinais", () => {
  it("o motivo é uma frase com os números, sem nome de variável", () => {
    for (const series of [ORGANIC_PEAK, BOUGHT_PEAK, BOUGHT_PEAK.slice(0, 10)]) {
      const { reason } = classify(series);
      expect(reason).toMatch(/\d/);
      expect(reason).not.toMatch(/_|undefined|NaN/);
      expect(reason.endsWith(".")).toBe(true);
    }
  });

  it("devolve os três sinais sempre, com valor, limiar e explicação", () => {
    const verdict = classify(ORGANIC_PEAK);
    expect(verdict.signals.map((entry) => entry.name)).toEqual(["sudden_onset", "abrupt_drop", "mechanical_repetition"]);
    for (const entry of verdict.signals) {
      expect(typeof entry.value).toBe("number");
      expect(typeof entry.threshold).toBe("number");
      expect(entry.explanation).not.toBe("");
    }
    expect(verdict.hours).toBe(ORGANIC_PEAK.length);
  });
});

describe("API", () => {
  const app = createApp();

  async function post(body: unknown): Promise<Response> {
    return app.request("/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("recebe a série e devolve classificação, motivo e sinais", async () => {
    const res = await post({ views: BOUGHT_PEAK });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Verdict;
    expect(body.classification).toBe("suspicious");
    expect(body.reason).not.toBe("");
    expect(body.signals).toHaveLength(3);
  });

  it("recusa série vazia, com número negativo ou que não é lista", async () => {
    expect((await post({ views: [] })).status).toBe(422);
    expect((await post({ views: [10, -1] })).status).toBe(422);
    expect((await post({ views: "100,200" })).status).toBe(422);
    expect((await post({})).status).toBe(422);
  });
});
