import type { TwistyPlayer } from "cubing/twisty";

// The parts of cubing.js's (internal) TwistyPropSource that we use.  (Its
// set() also accepts a promise, so T is inferred from the listener.)
interface PropSource<T> {
  set(value: NoInfer<T>): void;
  addFreshListener(listener: (value: T) => void): void;
}

// Returns the initial value.
function setupPropCheckbox<T extends string>(
  domID: string,
  prop: PropSource<T>,
  checkedValue: NoInfer<T>,
  uncheckedValue: NoInfer<T>,
) {
  const elem = document.getElementById(domID) as HTMLInputElement;
  const update = () => {
    prop.set(elem.checked ? checkedValue : uncheckedValue);
  };
  update();
  prop.addFreshListener((value) => {
    elem.checked = ![uncheckedValue].includes(value);
  });
  elem.addEventListener("change", update);
}

function setupTempoScale(tempoScaleProp: PropSource<number>): void {
  const tempoScaleInput = document.querySelector(
    "#tempo-scale",
  ) as HTMLInputElement;
  const tempoScaleDisplay = document.querySelector(
    "#tempo-scale-display",
  ) as HTMLSpanElement;
  tempoScaleInput.addEventListener("input", () => {
    tempoScaleProp.set(Number.parseFloat(tempoScaleInput.value));
    tempoScaleDisplay.textContent = `${tempoScaleInput.value}×`;
  });
  tempoScaleProp.addFreshListener((tempoScale) => {
    tempoScaleInput.value = tempoScale.toString();
    tempoScaleDisplay.textContent = `${tempoScale}×`;
  });
}

export function setupPropInputs(twistyPlayer: TwistyPlayer): void {
  setupPropCheckbox(
    "visualization-3D",
    twistyPlayer.experimentalModel.visualizationFormat,
    "PG3D",
    "2D",
  );
  setupPropCheckbox(
    "back-view-side-by-side",
    twistyPlayer.experimentalModel.backView,
    "side-by-side",
    "top-right",
  );
  setupPropCheckbox(
    "foundation-display-opaque",
    twistyPlayer.experimentalModel.twistySceneModel.foundationDisplay,
    "opaque",
    "none",
  );
  setupPropCheckbox(
    "hint-facelets-floating",
    twistyPlayer.experimentalModel.twistySceneModel.hintFacelet,
    "floating",
    "none",
  );
  setupTempoScale(twistyPlayer.experimentalModel.tempoScale);
}
