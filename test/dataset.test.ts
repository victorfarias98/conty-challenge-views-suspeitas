import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classify } from "../src/classifier.ts";
import { CATEGORIES, DATASET_SEED, HOURS, generateDataset, serializeDataset } from "../src/dataset.ts";
import { evaluate, formatRate, readMetricsBlock, renderMetrics } from "../src/evaluate.ts";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const committed = readFileSync(new URL("../dataset/series.json", import.meta.url), "utf8");
const dataset = generateDataset(DATASET_SEED);
const metrics = evaluate(dataset);

describe("dataset sintético", () => {
  it("é reproduzível: o arquivo commitado é exatamente o que o gerador produz", () => {
    expect(committed).toBe(serializeDataset(dataset));
    expect(serializeDataset(generateDataset(DATASET_SEED))).toBe(committed);
  });

  it("muda quando a semente muda", () => {
    expect(serializeDataset(generateDataset(DATASET_SEED + 1))).not.toBe(committed);
  });

  it("tem a quantidade declarada de cada tipo, com casos legítimos e suspeitos", () => {
    for (const row of metrics.by_category) expect(row.total).toBe(CATEGORIES[row.category].count);
    expect(metrics.legitimate_total).toBeGreaterThan(0);
    expect(metrics.suspicious_total).toBeGreaterThan(0);
    expect(dataset.every((series) => series.views.length === HOURS)).toBe(true);
  });
});

describe("números do README", () => {
  it("a taxa de falso positivo do README é a medida agora, não uma estimativa", () => {
    const published = /Taxa de falso positivo: ([\d,]+%)/.exec(readMetricsBlock(readme))?.[1];
    expect(published).toBe(formatRate(metrics.false_positive_rate));
  });

  it("o bloco inteiro de métricas do README é o que o comando gera", () => {
    // Se falhar: rode `npm run evaluate -- --write-readme` e revise a diferença.
    expect(readMetricsBlock(readme)).toBe(renderMetrics(metrics));
  });
});

describe("o que o README afirma sobre cada tipo", () => {
  const row = (category: keyof typeof CATEGORIES) => metrics.by_category.find((entry) => entry.category === category)!;

  it("nenhum vídeo que estourou de verdade é acusado", () => {
    expect(row("organic_viral").suspicious).toBe(0);
    expect(row("organic_steady").suspicious).toBe(0);
  });

  it("todo pico comprado e toda entrega mecânica são detectados", () => {
    expect(row("bought_spike").suspicious).toBe(row("bought_spike").total);
    expect(row("bot_drip").suspicious).toBe(row("bot_drip").total);
  });

  it("compartilhamento por perfil grande fica sem veredito em vez de acusado", () => {
    expect(row("organic_reshare").suspicious).toBe(0);
    expect(row("organic_reshare").inconclusive).toBe(row("organic_reshare").total);
  });

  it("os falsos positivos vêm todos do tipo que o README declara como limite", () => {
    expect(row("organic_flash").suspicious).toBe(metrics.false_positives);
  });

  it("o robô disfarçado passa, como o README declara em 'o que não detecta'", () => {
    expect(row("bot_ramped").suspicious).toBe(0);
  });

  it("toda série suspeita traz pelo menos um sinal disparado no motivo", () => {
    for (const series of dataset) {
      const verdict = classify(series.views);
      if (verdict.classification !== "suspicious") continue;
      expect(verdict.signals.some((signal) => signal.triggered && verdict.reason.includes(signal.explanation))).toBe(true);
    }
  });
});
