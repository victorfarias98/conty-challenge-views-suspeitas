# Conty. Views que não parecem humanas

Classificador explicável para a série de views por hora de um post. Recebe a série, devolve a classificação, um motivo em português e os sinais que usou. Não há modelo: são três medidas com limiar e uma regra de decisão de três linhas.

## Como rodar

Node 22 ou mais novo.

```bash
npm install
npm test
npm run evaluate   # gera o dataset e calcula as taxas
npm run dev        # API em http://127.0.0.1:3009
```

## Por onde ler

1. `src/classifier.ts`: os três sinais, os limiares e a decisão. É o arquivo que importa.
2. `src/dataset.ts`: o gerador sintético, um tipo de série por função.
3. `src/evaluate.ts` e `scripts/evaluate.ts`: a medição e o trecho de métricas deste README.
4. `test/classifier.test.ts` (casos óbvios) e `test/dataset.test.ts` (números do README).

## O critério

A ideia por trás dos três sinais é uma só: gente de verdade chega e vai embora aos poucos, e nunca no mesmo número hora após hora.

| Sinal | O que mede | Dispara quando |
|---|---|---|
| `sudden_onset` | views de uma hora divididas pelas da hora anterior | sobe 10 vezes ou mais em uma hora, chegando a pelo menos 500 views |
| `abrupt_drop` | fração das views perdida de uma hora para a seguinte | cai 80% ou mais em uma hora, partindo de pelo menos 500 views |
| `mechanical_repetition` | horas seguidas com até 1% de diferença para a hora anterior | 6 horas ou mais, com pelo menos 100 views por hora |

Cada sinal disparado vale 1 ponto. A repetição vale 2 quando passa de 12 horas, porque meio dia no mesmo número não tem explicação humana.

| Pontos | Classificação |
|---|---|
| 2 ou mais | `suspicious` |
| 1 | `inconclusive` |
| 0 | `legitimate` |

Série com menos de 24 horas é sempre `inconclusive`.

Os limiares estão em `THRESHOLDS`, no topo de `src/classifier.ts`.

### Quando o classificador prefere não acusar

Um sinal sozinho tem explicação inocente, então vira `inconclusive`, com o motivo dizendo qual:

- **Só a subida:** um perfil grande pode ter compartilhado o post. O salto é instantâneo, mas a audiência vai embora aos poucos.
- **Só a queda:** o post pode ter sido removido, ou a plataforma parou de distribuí-lo.
- **Só seis a onze horas iguais:** pode ser coincidência.

`inconclusive` não é acusação. É o classificador dizendo que viu algo e que não basta.

### Pico orgânico e pico comprado

Os dois chegam ao mesmo número; o que muda é a forma. O teste "pico orgânico e pico comprado não caem no mesmo balde" usa duas séries com o mesmo pico de 20 mil views e o mesmo tamanho:

- **Orgânico:** triplica por quatro horas até o pico e perde 15% por hora depois. Nenhum sinal dispara. `legitimate`.
- **Comprado:** salta da base para 20 mil em uma hora, fica reto cinco horas e volta à base em uma hora. Subida e queda disparam. `suspicious`.

### O que ele não detecta

- **Robô disfarçado.** Bots que sobem e descem aos poucos, com ruído, passam como legítimos. No dataset é o tipo `bot_ramped`, e nenhum é detectado.
- **Volume baixo.** Abaixo de 500 views por hora (100 para a repetição) nenhum sinal dispara. Pico comprado pequeno passa.
- **Multidão relâmpago de verdade.** Uma menção ao vivo ou um push traz gente real que chega e sai em uma ou duas horas. A forma é a mesma de um pico comprado, e o classificador acusa. É de onde vêm os falsos positivos do dataset (`organic_flash`).
- **Tudo o que não é forma.** Só entram views por hora. Origem do tráfego, retenção, proporção entre views e curtidas, contas repetidas: nada disso é visto.
- **Fraude diluída.** Views compradas espalhadas por dias, misturadas ao ciclo normal, não mudam a forma.

## Dataset e taxa de falso positivo

`npm run evaluate` gera 350 séries de 96 horas a partir de uma semente fixa (`DATASET_SEED`), grava em `dataset/series.json`, roda o classificador e imprime o trecho abaixo. `npm run evaluate -- --write-readme` também o escreve aqui.

<!-- metrics:start -->
**Taxa de falso positivo: 2,6%** (6 de 230 séries legítimas classificadas como suspeitas).

- Legítimas sem veredito: 33 de 230 (14,3%).
- Suspeitas detectadas: 83,3% de 120.

| Tipo de série | Rótulo | Total | Classificada legítima | Sem veredito | Classificada suspeita |
|---|---|---|---|---|---|
| `organic_steady` | legítima | 80 | 80 | 0 | 0 |
| `organic_viral` | legítima | 80 | 80 | 0 | 0 |
| `organic_small` | legítima | 30 | 30 | 0 | 0 |
| `organic_reshare` | legítima | 24 | 0 | 24 | 0 |
| `organic_removed` | legítima | 10 | 1 | 9 | 0 |
| `organic_flash` | legítima | 6 | 0 | 0 | 6 |
| `bought_spike` | suspeita | 60 | 0 | 0 | 60 |
| `bot_drip` | suspeita | 40 | 0 | 0 | 40 |
| `bot_ramped` | suspeita | 20 | 20 | 0 | 0 |
<!-- metrics:end -->

Um teste (`test/dataset.test.ts`) refaz a medição e falha se o número acima divergir, ou se `dataset/series.json` não for exatamente o que o gerador produz.

O que cada tipo de série representa:

| Tipo | Rótulo | Descrição |
|---|---|---|
| `organic_steady` | legítima | audiência normal: ciclo de dia e noite, ruído e queda lenta |
| `organic_viral` | legítima | vídeo que estourou: sobe em 3 a 5 horas e desce aos poucos |
| `organic_small` | legítima | perfil pequeno, poucas dezenas de views por hora |
| `organic_reshare` | legítima | perfil grande compartilhou: salto em uma hora, queda lenta depois |
| `organic_removed` | legítima | post removido: audiência normal que some de uma hora para outra |
| `organic_flash` | legítima | menção ao vivo ou push: salto e queda em uma ou duas horas, com gente de verdade |
| `bought_spike` | suspeita | pico comprado: salto, patamar reto por 2 a 8 horas e volta ao que era |
| `bot_drip` | suspeita | entrega mecânica: o mesmo volume somado por 14 a 40 horas seguidas |
| `bot_ramped` | suspeita | robô disfarçado: sobe e desce aos poucos, com ruído, imitando gente |

### Como ler esses números

A taxa é medida, mas o dataset é sintético e foi escrito por quem escreveu o classificador. Ela diz como o critério se comporta nos padrões que eu soube imaginar, não como se comportaria em dados reais. Em particular:

- Os falsos positivos vêm todos de um tipo que coloquei de propósito (`organic_flash`), na proporção que escolhi. Mude a quantidade desse tipo e a taxa muda junto.
- Os tipos que o classificador acerta em 100% foram gerados com as mesmas formas que os sinais procuram.

Para confiar na taxa em produção, o passo seguinte é rodar o classificador em séries reais já rotuladas.

## API

```bash
curl -s -X POST localhost:3009/classify -H 'content-type: application/json' \
  -d '{"views":[300,310,290, ...]}'
```

`views` é uma lista de números maiores ou iguais a zero, um por hora, da mais antiga para a mais recente (até 2160 horas). Entrada inválida responde `422`.

Resposta para o pico comprado do teste:

```json
{
  "score": 2,
  "signals": [
    {
      "name": "sudden_onset",
      "triggered": true,
      "weight": 1,
      "value": 69,
      "threshold": 10,
      "hour": 30,
      "explanation": "as views subiram 69,0 vezes em uma hora (de 291 para 20080, na hora 30)"
    },
    {
      "name": "abrupt_drop",
      "triggered": true,
      "weight": 1,
      "value": 0.984,
      "threshold": 0.8,
      "hour": 35,
      "explanation": "as views caíram 98% em uma hora (de 20040 para 318, na hora 35)"
    },
    {
      "name": "mechanical_repetition",
      "triggered": false,
      "weight": 0,
      "value": 2,
      "threshold": 6,
      "hour": null,
      "explanation": "a maior sequência de horas com o mesmo número de views foi de 2"
    }
  ],
  "hours": 66,
  "total_views": 118384,
  "classification": "suspicious",
  "reason": "Padrão incompatível com audiência humana: as views subiram 69,0 vezes em uma hora (de 291 para 20080, na hora 30); e as views caíram 98% em uma hora (de 20040 para 318, na hora 35). Gente de verdade chega e vai embora aos poucos, e nunca no mesmo número hora após hora."
}
```

Motivo para o pico orgânico do teste:

```
Nenhum padrão incompatível com audiência humana. A subida mais forte em uma hora foi de 3,5 vezes; a maior queda em uma hora foi de 25%; a maior sequência de horas com o mesmo número de views foi de 1.
```

Motivo para um salto com queda lenta:

```
Sem veredito: as views subiram 71,5 vezes em uma hora (de 291 para 20800, na hora 30), mas esse foi o único sinal e um perfil grande pode ter compartilhado o post. Um sinal isolado não basta para acusar.
```

## O que ficou de fora

- **Validação com dados reais**, que é o que falta para os limiares serem mais do que um palpite informado.
- **Sazonalidade.** O classificador não usa o ciclo de dia e noite como sinal; ausência de ciclo seria um bom quarto sinal para séries longas.
- **Granularidade.** Só séries por hora. Em séries por minuto os limiares seriam outros.
- **Horas faltando.** A série precisa vir completa; um buraco na coleta viraria uma queda abrupta.
- **Persistência.** A API não guarda nada.

## Uso de IA

O código, o gerador do dataset, os testes e este README foram escritos com Claude Code (Claude Opus), a partir do enunciado. Os três sinais, os limiares e os tipos de série do dataset foram propostos pela IA.

Verificação automática, rodada pela IA e não por mim: `npm test` passa com 25 testes em 2 arquivos e `npx tsc --noEmit` não acusa erro. Entre os testes estão "a taxa de falso positivo do README é a medida agora, não uma estimativa" e "é reproduzível: o arquivo commitado é exatamente o que o gerador produz".

O que eu revisei: os padrões de backend, as tipagens, os early returns, as constantes e se os testes realmente testam os cenários de falha.
