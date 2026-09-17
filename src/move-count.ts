import {
  ExperimentalCommonMetric,
  experimentalCountMetricMoves,
} from "cubing/notation";
import type { TwistyPlayer } from "cubing/twisty";

// The move count shown next to the controls, e.g. "(OB: 7)(OBQ: 8)(E: 7)".
// A copy of cubing.js's internal constructMoveCountDisplay, using only the
// public API.

const ABBREVIATIONS: Partial<Record<ExperimentalCommonMetric, string>> = {
  [ExperimentalCommonMetric.OuterBlockTurnMetric]: "OB",
  [ExperimentalCommonMetric.OuterBlockQuantumTurnMetric]: "OBQ",
  [ExperimentalCommonMetric.RangeBlockTurnMetric]: "RB",
  [ExperimentalCommonMetric.RangeBlockQuantumTurnMetric]: "RBQ",
  [ExperimentalCommonMetric.ExecutionTurnMetric]: "E",
};

const EXPLANATIONS: Partial<Record<ExperimentalCommonMetric, string>> = {
  [ExperimentalCommonMetric.OuterBlockTurnMetric]:
    'HTM = OBTM ("Outer Block Turn Metric")',
  [ExperimentalCommonMetric.OuterBlockQuantumTurnMetric]:
    'QTM = OBQTM ("Outer Block Quantum Turn Metric")',
  [ExperimentalCommonMetric.RangeBlockTurnMetric]:
    'STM = RBTM ("Range Block Turn Metric")',
  [ExperimentalCommonMetric.RangeBlockQuantumTurnMetric]:
    'SQTM = RBQTM ("Range Block Quantum Turn Metric")',
  [ExperimentalCommonMetric.ExecutionTurnMetric]:
    'ETM ("Execution Turn Metric")',
};

export function constructMoveCountDisplay(
  model: TwistyPlayer["experimentalModel"],
  elem: HTMLElement,
): void {
  async function update() {
    const [algWithIssues, puzzleLoader] = await Promise.all([
      model.puzzleAlg.get(),
      model.puzzleLoader.get(),
    ]);
    elem.textContent = "";
    if (algWithIssues.issues.errors.length !== 0) {
      return;
    }
    const metrics: ExperimentalCommonMetric[] = [];
    if (puzzleLoader.id === "3x3x3") {
      metrics.push(
        ExperimentalCommonMetric.OuterBlockTurnMetric,
        ExperimentalCommonMetric.OuterBlockQuantumTurnMetric,
        ExperimentalCommonMetric.RangeBlockTurnMetric,
      );
    } else if (puzzleLoader.pg) {
      metrics.push(
        ExperimentalCommonMetric.RangeBlockTurnMetric,
        ExperimentalCommonMetric.RangeBlockQuantumTurnMetric,
      );
    }
    metrics.push(ExperimentalCommonMetric.ExecutionTurnMetric);
    for (const metric of metrics) {
      const span = elem.appendChild(document.createElement("span"));
      span.title = EXPLANATIONS[metric] ?? "";
      span.textContent = `(${ABBREVIATIONS[metric]}: ${experimentalCountMetricMoves(puzzleLoader, metric, algWithIssues.alg)})`;
    }
  }
  model.puzzleAlg.addFreshListener(update);
  model.puzzleID.addFreshListener(update);
}
