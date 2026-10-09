import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DATASET_SEED, generateDataset, serializeDataset } from "../src/dataset.ts";
import { evaluate, renderMetrics, replaceMetricsBlock } from "../src/evaluate.ts";

// Gera o dataset, mede o classificador nele e imprime as taxas.
// Com --write-readme, também atualiza o trecho de métricas do README.

const datasetUrl = new URL("../dataset/series.json", import.meta.url);
const readmeUrl = new URL("../README.md", import.meta.url);

const dataset = generateDataset(DATASET_SEED);
mkdirSync(new URL("../dataset/", import.meta.url), { recursive: true });
writeFileSync(datasetUrl, serializeDataset(dataset));

const block = renderMetrics(evaluate(dataset));
console.log(`semente ${DATASET_SEED}, ${dataset.length} séries gravadas em dataset/series.json\n`);
console.log(block);

if (process.argv.includes("--write-readme")) {
  writeFileSync(readmeUrl, replaceMetricsBlock(readFileSync(readmeUrl, "utf8"), block));
  console.log("\nREADME atualizado.");
}
