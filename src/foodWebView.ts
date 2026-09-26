import { FOOD_SOURCES, SPECIES_LABELS, type SimulationSnapshot, type EnergyFlowMetric, type ForestSimulation } from './model.ts';

export function foodWebMarkup(snapshot: SimulationSnapshot, diet: ReturnType<ForestSimulation['getFoxDiet']>, flows: readonly EnergyFlowMetric[], mode: 'numbers' | 'energy', coreMarkup: string): string {
  const rabbitShare = Math.round(diet.rabbitPercent ?? 0);
  const dietMarkup = diet.rabbitPercent === null ? '<p class="fox-diet-empty">최근 섭식 없음</p>'
    : `<dl class="fox-diet-shares"><div><dt>토끼</dt><dd>${rabbitShare}%</dd></div><div><dt>식물성 먹이</dt><dd>${100 - rabbitShare}%</dd></div></dl>`;
  const energyMarkup = mode === 'energy' ? `<div class="fox-energy">${flows.filter(flow => flow.target === 'fox').map(flow =>
    `<p>${flow.source === 'rabbit' ? '토끼' : '식물성 먹이'} → 붉은여우 <strong>${flow.rate.toFixed(1)}</strong></p>`).join('')}<small>최근 20 step · 모델 에너지/step</small></div>` : '';
  const edges = Object.entries(FOOD_SOURCES).filter(([target]) => flows.some(flow => flow.target === target)).flatMap(([target, sources]) => sources.map(source =>
    `<span>${source === 'vegetation' ? target === 'fox' ? '식물성 먹이' : '식생' : SPECIES_LABELS[source]} → ${SPECIES_LABELS[target as keyof typeof SPECIES_LABELS]}</span>`));
  return `<div class="food-web-layout"><div class="food-web-chain">${coreMarkup}</div><aside class="fox-card" aria-label="붉은여우 잡식 정보">
    <div class="fox-card-heading"><span>붉은여우 <small>잡식</small></span><strong data-fox-count>${snapshot.agents.fox?.length ?? 0}<small>마리</small></strong></div>
    <p>토끼와 식물성 먹이를 모두 이용하는 잡식성 소비자입니다.</p>${energyMarkup}
    <div class="fox-diet"><h3>최근 ${diet.window} step 섭식 에너지</h3>${dietMarkup}</div>
    </aside></div><div class="food-web-edges" aria-label="먹이에서 소비자로 향하는 연결">${edges.join('')}</div>`;
}
