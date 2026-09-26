import { SPECIES_LABELS, type ForestSimulation, type Intervention, type Species } from './model.ts';

export function interventionLabel(event: Intervention): string {
  return `${SPECIES_LABELS[event.species]} ${event.kind === 'introduce' ? `+${event.amount.toLocaleString('ko-KR')}` : '제거'}`;
}

export function groupInterventions(events: readonly Intervention[], firstStep: number, lastStep: number): { step: number; events: Intervention[] }[] {
  const groups = new Map<number, Intervention[]>();
  for (const event of events) {
    if (event.step < firstStep || event.step > lastStep) continue;
    const group = groups.get(event.step) ?? [];
    group.push(event);
    groups.set(event.step, group);
  }
  return [...groups].map(([step, items]) => ({ step, events: items }));
}

interface RuntimeControls {
  simulation: () => ForestSimulation;
  isFree: () => boolean;
  isRunning: () => boolean;
  setRunning: (running: boolean) => void;
}

/** One paused transaction, tied to a particular experiment and logical step. */
export class InterventionSession {
  private controls: RuntimeControls;
  private pending: { simulation: ForestSimulation; step: number; wasRunning: boolean } | null = null;

  constructor(controls: RuntimeControls) { this.controls = controls; }

  begin(): number | null {
    if (!this.controls.isFree() || this.pending) return null;
    const wasRunning = this.controls.isRunning();
    this.controls.setRunning(false);
    const simulation = this.controls.simulation();
    this.pending = { simulation, step: simulation.getSnapshot().step, wasRunning };
    return this.pending.step;
  }

  private isCurrent(): boolean {
    return this.pending !== null && this.controls.isFree()
      && this.pending.simulation === this.controls.simulation()
      && this.pending.step === this.controls.simulation().getSnapshot().step;
  }

  confirm(kind: Intervention['kind'], species: Species, amount = 1): Intervention | null {
    if (!this.isCurrent()) return null;
    const simulation = this.pending!.simulation;
    const changed = kind === 'introduce' ? simulation.introduceSpecies(species, amount) : simulation.removeSpecies(species);
    if (!changed) return null;
    this.pending = null;
    this.controls.setRunning(false);
    return simulation.getInterventions().at(-1)!;
  }

  cancel(): void {
    const resume = this.isCurrent() && this.pending!.wasRunning;
    this.pending = null;
    if (resume) this.controls.setRunning(true);
  }
}
