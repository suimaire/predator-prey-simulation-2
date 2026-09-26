import { SPECIES_LABELS, type SimulationEvent } from './model.ts';

export function experimentEventLabel(event: SimulationEvent): string {
  const species = SPECIES_LABELS[event.species];
  if (event.kind === 'extinction') return `${species} 멸종`;
  const amount = event.amount.toLocaleString('ko-KR');
  if (event.kind === 'introduce') return `${species} +${amount} ${event.reintroduction ? '재도입' : '도입'}`;
  return event.resultingCount === 0 ? `${species} 전체 제거` : `${species} −${amount} 제거`;
}

export class ExperimentLog {
  readonly element = document.createElement('section');
  private body = document.createElement('div');
  private events: readonly SimulationEvent[] | null = null;
  private eventCount = -1;

  constructor() {
    this.element.id = 'experiment-log';
    this.element.className = 'experiment-card experiment-log';
    this.element.setAttribute('aria-labelledby', 'experiment-log-heading');
    this.element.innerHTML = '<h2 id="experiment-log-heading">실험 기록</h2>';
    this.body.className = 'experiment-log-body';
    this.body.tabIndex = 0;
    this.body.setAttribute('role', 'region');
    this.body.setAttribute('aria-label', '실험 사건 목록, 최신순');
    this.element.append(this.body);
  }

  render(events: readonly SimulationEvent[]): void {
    // Keep a reader's scroll position and DOM intact during event-free ticks.
    if (this.events === events && this.eventCount === events.length) return;
    const newRun = this.events !== events;
    this.events = events;
    this.eventCount = events.length;
    if (events.length === 0) {
      this.body.innerHTML = '<p class="experiment-log-empty">아직 기록된 사건이 없습니다.<small>종 도입, 제거, 멸종 등의 사건이 여기에 기록됩니다.</small></p>';
    } else {
      this.body.innerHTML = `<ol>${[...events].reverse().map(event => `<li><span class="experiment-event-step">Step ${event.step.toLocaleString('ko-KR')}</span><span>${experimentEventLabel(event)}</span></li>`).join('')}</ol>`;
    }
    if (newRun) this.body.scrollTop = 0;
  }
}
